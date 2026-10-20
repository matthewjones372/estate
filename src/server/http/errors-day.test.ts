import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, serverFor, settings } from "../fixture"
import { type Call, reply } from "../remote"
import type { Settings } from "../settings"

const viewer = settings({ anonymous: { name: "visitor", role: "viewer" } })

/**
 * Lines a second apart, the errors first and then the quieter lines after them, newest last. The stubs below answer
 * whatever the window, so the times only order them.
 */
const written = (errors: number, quiet: number, quietly = "INFO all well") => {
  const end = Date.parse("2026-10-03T12:00:00Z")
  const texts = [
    ...Array.from({ length: errors }, (_, at) => `ERROR order ${at} lost`),
    ...Array.from({ length: quiet }, () => quietly),
  ]
  return texts.map((text, at) => ({ at: end - (texts.length - at) * 1000, text }))
}

type Written = ReturnType<typeof written>

/** Loki as it answers `query_range`: the newest `limit` lines its selector's line filter lets through. */
const loki = (lines: Written, calls: Call[]) => (call: Call) => {
  if (!call.url.startsWith("http://loki/")) return undefined
  calls.push(call)
  const asked = new URL(call.url).searchParams
  const filter = /\|~ "\(\?i\)(.*)"$/.exec(asked.get("query") ?? "")?.[1]
  const pattern = filter === undefined ? undefined : new RegExp(filter.replaceAll("\\\\", "\\"), "i")
  const found = lines.filter((line) => pattern?.test(line.text) ?? true).slice(-Number(asked.get("limit")))
  return reply({
    status: "success",
    data: {
      resultType: "streams",
      result: [
        { stream: { pod: "storefront-1" }, values: found.map((line) => [`${line.at}000000`, line.text]).reverse() },
      ],
    },
  })
}

/** Datadog's log search: the newest `page.limit` lines, at most 1000, that its query's `status:(…)` lets through. */
const datadog = (lines: Written, calls: Call[]) => (call: Call) => {
  if (!call.url.startsWith("https://datadog/")) return undefined
  calls.push(call)
  const asked = JSON.parse(call.body ?? "{}")
  const statuses = /status:\(([^)]*)\)/.exec(asked.filter.query)?.[1]?.split(" OR ")
  const statusOf = (text: string) => text.split(" ")[0]?.toLowerCase() ?? ""
  const found = lines
    .filter((line) => statuses?.includes(statusOf(line.text)) ?? true)
    .slice(-Math.min(asked.page.limit, 1000))
  return reply({
    data: found
      .map((line) => ({
        attributes: { timestamp: new Date(line.at).toISOString(), message: line.text, status: statusOf(line.text) },
      }))
      .reverse(),
  })
}

/** Elasticsearch's `_search`: the newest `size` documents, without those whose `log.level` the query rules out. */
const elastic = (lines: Written, calls: Call[]) => (call: Call) => {
  if (call.url !== "http://es:9200/logs-*/_search") return undefined
  calls.push(call)
  const asked = JSON.parse(call.body ?? "{}")
  const ruledOut: ReadonlyArray<string> = (asked.query.bool.must_not ?? []).flatMap(
    (clause: { terms?: Record<string, ReadonlyArray<string>> }) => clause.terms?.["log.level"] ?? [],
  )
  const levelOf = (text: string) => text.split(" ")[0]?.toLowerCase() ?? ""
  const found = lines.filter((line) => !ruledOut.includes(levelOf(line.text))).slice(-asked.size)
  return reply({
    hits: {
      hits: found
        .map((line) => ({
          _source: {
            "@timestamp": new Date(line.at).toISOString(),
            message: line.text,
            log: { level: levelOf(line.text) },
          },
        }))
        .reverse(),
    },
  })
}

const withLoki: Settings = { ...viewer, sources: { staging: { loki: { url: "http://loki" } }, production: {} } }

const errorsOver = (answer: (call: Call) => ReturnType<typeof reply> | undefined, configured: Settings = withLoki) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const server = yield* serverFor(configured, undefined, answer)
      const read = yield* ask(
        server,
        new Request("http://estate/api/logs/errors?env=staging&service=storefront&range=24h"),
      )
      return read.json()
    }),
  )

describe("a service's errors over a day", () => {
  test("are found from Loki however many quieter lines came after them", () => {
    const calls: Call[] = []
    return errorsOver(loki(written(5, 3000), calls)).then((answer) => {
      expect(answer).toMatchObject({
        from: "Loki",
        capped: false,
        groups: [{ shape: "ERROR order ‹n› lost", count: 5 }],
      })
    })
  })

  test("say when there were more than were read", () =>
    errorsOver(loki(written(2500, 10), [])).then((answer) => {
      expect(answer).toMatchObject({ capped: true, groups: [{ count: 2000 }] })
    }))

  test("are found from Datadog by the statuses that are errors, and capped at its page of 1000", () => {
    const calls: Call[] = []
    const withDatadog = {
      ...viewer,
      sources: {
        staging: { datadog: { url: "https://datadog", apiKey: Redacted.make("api"), appKey: Redacted.make("app") } },
        production: {},
      },
    }
    return Promise.all([
      errorsOver(datadog(written(5, 3000, "WARN slow"), calls), withDatadog),
      errorsOver(datadog(written(1200, 0), []), withDatadog),
    ]).then(([few, many]) => {
      expect(JSON.parse(calls[0]?.body ?? "{}").filter.query).toContain("status:(error)")
      expect(few).toMatchObject({ from: "Datadog", capped: false, groups: [{ count: 5 }] })
      expect(many).toMatchObject({ capped: true, groups: [{ count: 1000 }] })
    })
  })

  test("are found from Elasticsearch without the levels that are not errors", () => {
    const calls: Call[] = []
    const withElastic = {
      ...viewer,
      sources: { staging: { elasticsearch: { url: "http://es:9200" } }, production: {} },
    }
    return errorsOver(elastic(written(5, 3000), calls), withElastic).then((answer) => {
      expect(answer).toMatchObject({ from: "Elasticsearch", capped: false, groups: [{ count: 5 }] })
    })
  })
})

describe("a service's errors over a range", () => {
  test("are read once a minute however many ask, and not shared with another range or a since time", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withLoki, undefined, loki(written(5, 10), calls))
        const asked = (query: string) =>
          ask(server, new Request(`http://estate/api/logs/errors?env=staging&service=storefront&${query}`))
        const [first, second] = yield* Effect.all([asked("range=24h"), asked("range=24h")], { concurrency: 2 })
        yield* asked("range=24h")
        yield* asked("range=6h")
        yield* asked("since=2026-10-03T11:50:00Z")
        yield* asked("since=2026-10-03T11:50:00Z")
        return [first.json(), second.json()]
      }),
    ).then(([first, second]) => {
      expect(second).toEqual(first)
      expect(calls.length).toBe(4)
    })
  })
})
