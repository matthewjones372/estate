import { describe, expect, test } from "bun:test"
import { Effect, Redacted, Result } from "effect"
import { TestClock } from "effect/testing"
import type { Service } from "../../shared/catalog"
import { type Call, reply, stubRemote } from "../remote"
import type { SourcedAlert } from "../state"
import { datadogRanges } from "./datadog-metrics"
import { readMetrics } from "./metrics"

const datadog = { url: "https://datadog", apiKey: Redacted.make("api"), appKey: Redacted.make("app") }
const now = Date.parse("2026-10-03T12:00:00Z")

const services: ReadonlyArray<Service> = Array.from({ length: 50 }, (_, index) => ({
  name: `svc-${index}`,
  environments: [],
  load: {
    requests: `sum:trace.http.request.hits{service:svc-${index}}.as_rate()`,
    errors: `sum:trace.http.request.errors{service:svc-${index}}.as_rate()`,
    p99: `p99:trace.http.request{service:svc-${index}}`,
  },
}))

const catalog = { environments: [], services }

/** Datadog's timeseries answer for each query: the minute's points, the value its index in the call. */
const timeseries = (call: Call) => {
  const { attributes } = JSON.parse(call.body ?? "{}").data
  const times = [attributes.to - 120_000, attributes.to - 60_000, attributes.to]
  return reply({
    data: {
      attributes: {
        series: attributes.queries.flatMap((_: unknown, index: number) => [
          { query_index: index, group_tags: ["service:elsewhere"] },
          { query_index: index, group_tags: ["service:checkout"] },
        ]),
        times,
        values: attributes.queries.flatMap((_: unknown, index: number) => [
          [index, index, -1],
          [index, null, index + 0.5],
        ]),
      },
    },
  })
}

const monitors = [
  { id: 1, name: "CheckoutSlow", tags: [], query: "avg(last_5m):p99:trace.http.request{service:checkout} > 0.5" },
  { id: 2, name: "Composite", tags: [], query: "1 && 2" },
]

const fake =
  (calls: Call[], limited = false) =>
  (call: Call) => {
    calls.push(call)
    if (call.url.includes("/api/v1/monitor")) return reply(monitors)
    if (call.url.endsWith("/api/v2/query/timeseries"))
      return limited ? reply({ errors: ["Too many requests"] }, 429, { "x-ratelimit-reset": "42" }) : timeseries(call)
    return undefined
  }

describe("Datadog's metrics", () => {
  test("read fifty services' load in three calls, and a firing monitor's chart against its threshold in one more", () => {
    const calls: Call[] = []
    const firing: SourcedAlert = {
      id: "a1",
      name: "CheckoutSlow",
      state: "firing",
      severity: "critical",
      startsAt: "2026-10-03T11:50:00Z",
      labels: { service: "checkout" },
    }
    const program = Effect.flatMap(datadogRanges(datadog), (ranges) =>
      readMetrics(ranges, catalog, services, [], [firing], now),
    )
    return Effect.runPromise(Effect.result(program.pipe(Effect.provide(stubRemote(fake(calls)))))).then((read) => {
      const metrics = Result.isSuccess(read) ? read.success : undefined
      const asked = calls.filter((call) => call.url.endsWith("/api/v2/query/timeseries"))
      expect(asked.map((call) => JSON.parse(call.body ?? "{}").data.attributes.queries.length)).toEqual([50, 50, 50, 1])
      expect(asked[0]?.headers).toMatchObject({ "dd-api-key": "api", "dd-application-key": "app" })
      expect(metrics?.services["svc-0"]?.requests?.points.at(-1)).not.toBeNull()
      expect(metrics?.charts["a1"]).toMatchObject({ threshold: 0.5 })
      expect(metrics?.charts["a1"]?.points.at(-1)).toBe(0.5)
    })
  })

  test("that Datadog limits wait as long as it says, failing the read with the wait", () => {
    const calls: Call[] = []
    const program = Effect.gen(function* () {
      const ranges = yield* datadogRanges(datadog)
      const first = yield* Effect.result(ranges.range("sum:x{*}", { seconds: 3600, step: 60 }, now))
      const soon = yield* Effect.result(readMetrics(ranges, catalog, services.slice(0, 1), [], [], now))
      yield* TestClock.adjust("43 seconds")
      const later = yield* Effect.result(ranges.rules)
      return { first, soon, later }
    })
    return Effect.runPromise(
      program.pipe(Effect.provide(stubRemote(fake(calls, true))), Effect.provide(TestClock.layer())),
    ).then(({ first, soon, later }) => {
      expect(Result.isFailure(first) && first.failure.message).toBe(
        "Datadog limits metric queries: it allows more in 42s",
      )
      expect(Result.isFailure(soon) && soon.failure.message).toBe(
        "Datadog limits metric queries: it allows more in 42s",
      )
      expect(Result.isSuccess(later) && [...later.success]).toEqual([
        ["CheckoutSlow", "p99:trace.http.request{service:checkout} > 0.5"],
      ])
      expect(calls.filter((call) => call.url.endsWith("/timeseries"))).toHaveLength(1)
    })
  })
})
