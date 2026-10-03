import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result } from "effect"
import type { Service } from "../../shared/catalog"
import { catalog } from "../fixture"
import { platform } from "../platform"
import { type Call, reply, stubRemote } from "../remote"
import { answering as tableAnswers } from "./answers"
import { logsFor } from "./logs"

const fromTable = tableAnswers()

const storefront: Service = {
  ...(catalog.services[0] ?? { name: "storefront", environments: [] }),
  logs: { mask: ["\\b\\d{16}\\b"] },
}
const noon = Date.parse("2026-10-03T12:00:00Z")
const loki = { loki: { url: "http://loki/", tenant: "estate" } }
const cluster = { kubernetes: { url: "https://cluster", token: Redacted.make("t") } }

const stream = (pod: string, ...lines: ReadonlyArray<readonly [number, string]>) => ({
  stream: { pod, app: "storefront" },
  values: lines.map(([minute, text]) => [`${noon + minute * 60_000}000000`, text]),
})

const answering = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.url.startsWith("http://loki/loki/api/v1/query_range"))
    return reply({
      status: "success",
      data: {
        resultType: "streams",
        result: [
          stream("storefront-2", [2, "ERROR card 4111111111111111 declined"]),
          stream("storefront-1", [1, "INFO started"], [3, "WARN slow"]),
        ],
      },
    })
  const pod = /\/pods\/(storefront-\d)\/log\?/.exec(call.url)?.[1]
  if (pod === "storefront-1")
    return reply("2026-10-03T12:01:00.123456789Z INFO started\n2026-10-03T12:04:00.5Z ERROR lost 4111111111111111\n")
  if (pod === "storefront-2") return reply("2026-10-03T12:02:00Z WARN slow\nnot a line\n")
  return fromTable(call)
}

const read = (section: object, service = storefront) => {
  const calls: Call[] = []
  const logs = logsFor(section, service)
  if (logs === undefined) return Promise.resolve({ calls, from: undefined, lines: [] })
  return Effect.runPromise(
    logs.read(noon, noon + 10 * 60_000, 50).pipe(Effect.provide(Layer.merge(stubRemote(answering(calls)), platform))),
  ).then((lines) => ({ calls, from: logs.from, lines }))
}

describe("a service's lines", () => {
  test("come from Loki, in order, with their pod and level, masked, asking as the tenant", () =>
    read(loki).then(({ calls, from, lines }) => {
      expect(from).toBe("Loki")
      expect(lines.map((line) => [line.at.slice(11, 16), line.pod, line.level, line.text])).toEqual([
        ["12:01", "storefront-1", "INFO", "INFO started"],
        ["12:02", "storefront-2", "ERROR", "ERROR card ••• declined"],
        ["12:03", "storefront-1", "WARN", "WARN slow"],
      ])
      const url = new URL(calls[0]?.url ?? "")
      expect(url.searchParams.get("query")).toBe('{namespace="shop", app="storefront"}')
      expect(url.searchParams.get("start")).toBe(`${noon}000000`)
      expect(calls[0]?.headers).toMatchObject({ "x-scope-orgid": "estate" })
    }))

  test("come from each pod's own log through the cluster when there is no Loki", () =>
    read(cluster).then(({ from, lines, calls }) => {
      expect(from).toBe("the cluster")
      expect(lines.map((line) => [line.at, line.pod, line.text])).toEqual([
        ["2026-10-03T12:01:00.123Z", "storefront-1", "INFO started"],
        ["2026-10-03T12:02:00.000Z", "storefront-2", "WARN slow"],
        ["2026-10-03T12:04:00.500Z", "storefront-1", "ERROR lost •••"],
      ])
      const asked = new URL(calls.find((call) => call.url.includes("/log?"))?.url ?? "")
      expect(asked.searchParams.get("sinceTime")).toBe("2026-10-03T12:00:00.000Z")
    }))

  test("use the catalog's selector, and are not there without Loki or a namespace", () =>
    read({ loki: { url: "http://loki" } }, { ...storefront, logs: { selector: '{job="shop"}' } }).then(({ calls }) => {
      expect(new URL(calls[0]?.url ?? "").searchParams.get("query")).toBe('{job="shop"}')
      expect(logsFor({}, storefront)).toBeUndefined()
      expect(logsFor(cluster, { name: "nowhere", environments: [] })).toBeUndefined()
    }))

  test("that a tool does not give are a failure in its words", () => {
    const failing = (status: number, body: unknown) =>
      Effect.runPromise(
        Effect.result(
          (logsFor(loki, storefront)?.read(noon, noon, 1) ?? Effect.succeed([])).pipe(
            Effect.provide(
              Layer.merge(
                stubRemote(() => reply(body, status)),
                platform,
              ),
            ),
          ),
        ),
      )
    return Promise.all([failing(500, "down"), failing(200, { nothing: true })]).then(([down, odd]) => {
      expect(Result.isFailure(down) && down.failure.message).toBe("Loki answered 500: down")
      expect(Result.isFailure(odd) && odd.failure.message).toBe("Loki answered in a shape Estate does not know")
    })
  })
})
