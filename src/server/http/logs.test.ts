import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ask, type Server, serverFor, settings } from "../fixture"
import { type Call, reply } from "../remote"

const withLoki = (role: "viewer" | "operator", logs?: "viewer" | "operator") => ({
  ...settings({ anonymous: { name: "visitor", role }, ...(logs === undefined ? {} : { logs }) }),
  sources: { staging: { loki: { url: "http://loki" } }, production: {} },
})

const recent = () => `${Date.now() - 1000}000000`

/** Loki, answering every read with one new error line, counting the reads. */
const loki = (calls: Call[]) => (call: Call) => {
  if (!call.url.startsWith("http://loki/")) return undefined
  calls.push(call)
  return reply({
    status: "success",
    data: {
      resultType: "streams",
      result: [
        {
          stream: { pod: "storefront-1" },
          values: [
            [recent(), `ERROR order ${calls.length} lost`],
            [recent(), "INFO all well"],
          ],
        },
      ],
    },
  })
}

const get = (server: Server, path: string) => Effect.promise(() => server.handler(new Request(`http://estate${path}`)))

/** Reads an event stream until it has `count` messages, then lets it go. */
const messages = (response: Response, count: number): Promise<ReadonlyArray<string>> => {
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  const read = (text: string): Promise<string> =>
    reader === undefined || text.split("\n\n").length > count
      ? Promise.resolve(text)
      : reader.read().then(({ value, done }) => (done ? text : read(text + decoder.decode(value))))
  return read("").then((text) => (reader?.cancel() ?? Promise.resolve()).then(() => text.split("\n\n").slice(0, count)))
}

describe("a service's live lines", () => {
  test("are one reader shared by everyone watching, which stops a little after they leave", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withLoki("viewer"), undefined, loki(calls))
        const first = yield* get(server, "/logs?env=staging&service=storefront")
        const second = yield* get(server, "/logs?env=staging&service=storefront")
        expect(first.headers.get("content-type")).toBe("text/event-stream")
        const [one, two] = yield* Effect.promise(() => Promise.all([messages(first, 4), messages(second, 4)]))
        const readsWhileWatched = calls.length
        yield* Effect.promise(() => Bun.sleep(7500))
        const readsAfter = calls.length
        yield* Effect.promise(() => Bun.sleep(2500))
        return { one, two, readsWhileWatched, readsAfter, readsLater: calls.length }
      }),
    ).then(({ one, two, readsWhileWatched, readsAfter, readsLater }) => {
      const said = (stream: ReadonlyArray<string>) => stream.filter((message) => !message.startsWith(": still here"))
      expect(said(one)[0]).toContain('event: from\ndata: "Loki"')
      expect(said(one)[1]).toContain("event: lines")
      expect(JSON.parse(/data: (.*)/.exec(said(one)[1] ?? "")?.[1] ?? "{}")).toMatchObject({
        lines: [{ pod: "storefront-1", level: "ERROR" }, { level: "INFO" }],
        skipped: false,
      })
      expect(said(two)[1]).toBe(said(one)[1])
      // One reader every two seconds for both: two would have read twice as often.
      expect(readsWhileWatched).toBeLessThanOrEqual(2)
      expect(readsLater).toBe(readsAfter)
    })
  }, 20_000)
})

describe("a service's errors", () => {
  test("are grouped by message over a range, or since a time", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: Call[] = []
        const server = yield* serverFor(withLoki("viewer"), undefined, loki(calls))
        const grouped = yield* ask(
          server,
          new Request("http://estate/api/logs/errors?env=staging&service=storefront&range=6h"),
        )
        const since = yield* ask(
          server,
          new Request("http://estate/api/logs/errors?env=staging&service=storefront&since=2026-10-03T11:50:00Z"),
        )
        return { grouped, since, calls }
      }),
    ).then(({ grouped, since, calls }) => {
      expect(grouped.json()).toMatchObject({
        from: "Loki",
        groups: [{ shape: "ERROR order ‹n› lost", count: 1, pods: ["storefront-1"] }],
      })
      expect(since.status).toBe(200)
      const start = new URL(calls[1]?.url ?? "").searchParams.get("start")
      expect(start).toBe(`${Date.parse("2026-10-03T11:50:00Z")}000000`)
    }))

  test("are refused to a viewer where logs are for operators, and not there for a service without any", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const forOperators = yield* serverFor(withLoki("viewer", "operator"), undefined, loki([]))
        const refused = yield* ask(
          forOperators,
          new Request("http://estate/api/logs/errors?env=staging&service=storefront"),
        )
        const live = yield* get(forOperators, "/logs?env=staging&service=storefront")
        const open = yield* serverFor(withLoki("operator", "operator"), undefined, () => reply("down", 500))
        const none = yield* ask(open, new Request("http://estate/api/logs/errors?env=production&service=storefront"))
        const down = yield* ask(open, new Request("http://estate/api/logs/errors?env=staging&service=storefront"))
        const malformed = yield* ask(open, new Request("http://estate/api/logs/errors?env=staging"))
        const noLive = yield* get(open, "/logs?env=production&service=storefront")
        return { refused, live: live.status, none, down, malformed, noLive: noLive.status }
      }),
    ).then(({ refused, live, none, down, malformed, noLive }) => {
      expect([refused.status, refused.json()]).toEqual([403, { message: "logs are for operators here" }])
      expect(live).toBe(403)
      expect([none.status, none.json()]).toEqual([404, { message: "storefront has no logs to read in production" }])
      expect([down.status, down.json()]).toEqual([502, { message: "Loki answered 500: down" }])
      expect(malformed.status).toBe(400)
      expect(noLive).toBe(404)
    }))

  test("are grouped the same from Elasticsearch", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const configured = {
          ...settings({ anonymous: { name: "visitor", role: "viewer" } }),
          sources: { staging: { elasticsearch: { url: "http://es:9200" } }, production: {} },
        }
        const server = yield* serverFor(configured, undefined, (call) =>
          call.url === "http://es:9200/logs-*/_search"
            ? reply({
                hits: {
                  hits: [3, 2, 1].map((order) => ({
                    _source: {
                      "@timestamp": `2026-10-03T11:5${order}:00Z`,
                      message: `ERROR order ${order} lost`,
                      kubernetes: { pod: { name: "storefront-1" } },
                    },
                  })),
                },
              })
            : undefined,
        )
        return yield* ask(server, new Request("http://estate/api/logs/errors?env=staging&service=storefront&range=1h"))
      }),
    ).then((grouped) => {
      expect(grouped.json()).toMatchObject({
        from: "Elasticsearch",
        groups: [{ shape: "ERROR order ‹n› lost", count: 3, pods: ["storefront-1"] }],
      })
    }))
})
