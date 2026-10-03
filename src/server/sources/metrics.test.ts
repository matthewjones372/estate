import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { ask, catalog, estate, serverFor, settings, storefront } from "../fixture"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import type { SourcedAlert } from "../state"
import { readMetrics } from "./metrics"
import { onGrid, thresholdOf } from "./prometheus"

const now = Date.parse("2026-10-03T12:00:00Z")

/** Prometheus as a stub: each query answers a short series ending now, by what it asks. */
const prometheus =
  (calls: Call[] = []) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    const url = new URL(call.url)
    if (url.pathname === "/api/v1/rules") {
      return reply({
        data: {
          groups: [
            {
              rules: [
                { type: "alerting", name: "OrdersSlow", query: "histogram_quantile(0.99, x) > 0.15" },
                { type: "recording", name: "r", query: "y" },
              ],
            },
          ],
        },
      })
    }
    if (url.pathname !== "/api/v1/query_range") return undefined
    const query = url.searchParams.get("query") ?? ""
    const end = Number(url.searchParams.get("end"))
    const step = Number(url.searchParams.get("step"))
    if (query.includes("broken")) return reply("bad query", 400)
    const value = query.startsWith("histogram") ? "0.2" : query.includes("errors") ? "0" : "12"
    return reply({
      data: {
        result: [
          { metric: { app: "other" }, values: [[end, "999"]] },
          {
            metric: { app: "orders" },
            values: [
              [end - step, value],
              [end, value],
            ],
          },
        ].filter((each) => query.startsWith("histogram") || each.metric.app === "orders"),
      },
    })
  }

const services = [
  { ...storefront, load: { requests: "sum(rate(requests[1m]))", errors: "sum(rate(errors[1m]))", p99: "broken(" } },
  { name: "search", environments: ["staging"] },
]
const withMetrics = { ...catalog, services, vitals: [{ title: "Orders", query: "sum(orders)", unit: "/s" }] }
const firing: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-03T11:46:00Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}

const read = (answer: (call: Call) => Reply | undefined, alerts: ReadonlyArray<SourcedAlert> = [firing]) =>
  Effect.runPromise(
    Effect.result(
      readMetrics("http://prometheus", withMetrics, services, alerts, now).pipe(Effect.provide(stubRemote(answer))),
    ),
  )

describe("metrics from Prometheus", () => {
  test("give each service's load, the vitals and the map's rates over the last hour", () =>
    read(prometheus()).then((result) => {
      const metrics = Result.isSuccess(result) ? result.success : undefined
      expect(metrics?.services).toMatchObject({
        storefront: { requests: { now: 12 }, p99: { now: null, points: [] } },
        search: {},
      })
      expect(Object.values(metrics?.services ?? {})[0]?.requests?.points).toHaveLength(61)
      expect(metrics?.vitals.map((series) => series.now)).toEqual([12])
      expect(metrics?.edges).toEqual([12, null, null])
    }))

  test("draw a firing alert's measure, for its own labels, against its rule's threshold", () =>
    read(prometheus()).then((result) => {
      const chart = Result.isSuccess(result) ? Object.values(result.success.charts)[0] : undefined
      expect(chart?.threshold).toBe(0.15)
      expect(chart?.points.at(-1)).toBe(0.2)
    }))

  test("that do not answer fail the read, with Prometheus's words", () =>
    read(() => undefined).then((result) => {
      expect(Result.isFailure(result) && result.failure.message).toBe("Prometheus answered 404: not found")
    }))

  test("lay values on an even grid, null where there are none", () => {
    expect(
      onGrid(
        [
          [60, "1"],
          [180, "3"],
          [200, "NaN"],
        ],
        0,
        { seconds: 240, step: 60 },
      ),
    ).toEqual({ now: null, points: [null, 1, null, 3, null] })
  })

  test("read a rule's threshold from its comparison", () => {
    expect(thresholdOf("histogram_quantile(0.99, x) > 0.15")).toEqual({
      measure: "histogram_quantile(0.99, x)",
      threshold: 0.15,
    })
    expect(thresholdOf("sum(lag) >= 1e3")).toEqual({ measure: "sum(lag)", threshold: 1000 })
    expect(thresholdOf("up == 0")).toEqual({ measure: "up", threshold: 0 })
    expect(thresholdOf("absent(up)")).toBeUndefined()
  })
})

describe("load over a longer range", () => {
  const configured = {
    ...settings({ anonymous: { name: "visitor", role: "viewer" } }),
    sources: { staging: { prometheus: { url: "http://prometheus/" } }, production: {} },
  }

  test("is read from the environment's Prometheus with a coarser step", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured, estate({ catalog: withMetrics }), prometheus(calls))
        const answered = yield* ask(
          server,
          new Request("http://estate/api/load?env=staging&service=storefront&range=24h"),
        )
        expect(answered.json()).toMatchObject({ requests: { now: 12 }, errors: { now: 0 } })
        expect(new URL(calls[0]?.url ?? "").searchParams.get("step")).toBe("900")
        const missing = yield* ask(
          server,
          new Request("http://estate/api/load?env=staging&service=storefront&range=1y"),
        )
        expect(missing.status).toBe(404)
        const none = yield* ask(
          server,
          new Request("http://estate/api/load?env=production&service=storefront&range=6h"),
        )
        expect(none.json()).toEqual({ message: "production has no Prometheus" })
      }),
    )
  })
})
