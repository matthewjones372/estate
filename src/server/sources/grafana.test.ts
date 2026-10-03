import { describe, expect, test } from "bun:test"
import { Effect, Redacted, Result, SubscriptionRef } from "effect"
import { ask, environment, estate, serverFor, settings } from "../fixture"
import { type Call, reply, stubRemote } from "../remote"
import { Estate, type SourcedAlert } from "../state"
import { readAlerts } from "./alerts"
import { comparisonOf, grafanaRules } from "./grafana"
import { readMetrics } from "./metrics"

const grafana = { url: "http://grafana/", token: Redacted.make("glsa_secret") }

const rule = (data: ReadonlyArray<{ refId: string; model: object }>, condition = "C") => ({
  grafana_alert: { title: "OrdersSlow", condition, data },
})
const query = { refId: "A", model: { expr: "histogram_quantile(0.99, x)" } }
const reduce = { refId: "B", model: { type: "reduce", expression: "A" } }
const threshold = (type: string) => ({
  refId: "C",
  model: { type: "threshold", expression: "B", conditions: [{ evaluator: { type, params: [0.15] } }] },
})

const labels = { alertname: "OrdersSlow", app: "orders", grafana_folder: "Shop", __alert_rule_uid__: "u1" }

/** Grafana as a stub: its Alertmanager, its Prometheus-shaped alerts and its ruler, each only to the token. */
const answer = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  const signed = call.headers?.["authorization"] === "Bearer glsa_secret"
  if (call.url.startsWith("http://grafana") && !signed) return reply("unauthorised", 401)
  const path = call.url.replace("http://grafana", "")
  if (path.startsWith("/api/alertmanager/grafana/api/v2/alerts"))
    return reply([
      {
        labels,
        annotations: { summary: "Orders are slow" },
        startsAt: "2026-10-03T11:46:00Z",
        status: { state: "active", silencedBy: [], inhibitedBy: [] },
      },
    ])
  if (path === "/api/alertmanager/grafana/api/v2/silences" && call.method === "POST") return reply({ silenceID: "g1" })
  if (path === "/api/alertmanager/grafana/api/v2/silences") return reply([])
  if (path === "/api/prometheus/grafana/api/v1/alerts")
    return reply({
      data: {
        alerts: [
          { labels: { alertname: "DiskFilling" }, annotations: {}, state: "Pending", activeAt: "2026-10-03T11:58:00Z" },
          { labels, annotations: {}, state: "Alerting", activeAt: "2026-10-03T11:46:00Z" },
        ],
      },
    })
  if (path === "/api/ruler/grafana/api/v1/rules")
    return reply({ Shop: [{ name: "shop", rules: [rule([query, reduce, threshold("gt")])] }] })
  if (call.url.startsWith("http://prometheus/api/v1/rules")) return reply({ data: { groups: [] } })
  if (call.url.startsWith("http://prometheus/api/v1/query_range")) {
    const end = Number(new URL(call.url).searchParams.get("end"))
    return reply({
      data: {
        result: [
          { metric: { app: "other" }, values: [[end, "9"]] },
          { metric: { app: "orders" }, values: [[end, "0.2"]] },
        ],
      },
    })
  }
  return undefined
}

describe("a Grafana rule's comparison", () => {
  test("is its condition's threshold against the query it reduces", () => {
    expect(comparisonOf(rule([query, reduce, threshold("gt")]))).toBe("histogram_quantile(0.99, x) > 0.15")
    expect(comparisonOf(rule([query, threshold("lt")].map((each) => ({ ...each }))))).toBeUndefined()
    const classic = {
      refId: "C",
      model: {
        type: "classic_conditions",
        conditions: [{ evaluator: { type: "lt", params: [3] }, query: { params: ["A"] } }],
      },
    }
    expect(comparisonOf(rule([query, classic]))).toBe("histogram_quantile(0.99, x) < 3")
  })

  test("is nothing for an evaluator with no single threshold, or a rule that goes round in circles", () => {
    expect(comparisonOf(rule([query, reduce, threshold("within_range")]))).toBeUndefined()
    const circle = { refId: "B", model: { type: "math", expression: "C" } }
    expect(comparisonOf(rule([circle, threshold("gt")]))).toBeUndefined()
  })
})

describe("Grafana's alerting", () => {
  test("gives firing alerts from its Alertmanager and pending ones from its rules, with its token", () => {
    const calls: Call[] = []
    return Effect.runPromise(Effect.provide(readAlerts({ grafana }), stubRemote(answer(calls)))).then((alerts) => {
      expect(alerts.map((alert) => [alert.name, alert.state])).toEqual([
        ["OrdersSlow", "firing"],
        ["DiskFilling", "pending"],
      ])
      expect(calls.every((call) => call.headers?.["authorization"] === "Bearer glsa_secret")).toBe(true)
    })
  })

  test("says so in Grafana's name when it refuses", () =>
    Effect.runPromise(
      Effect.result(Effect.provide(readAlerts({ grafana: { url: "http://grafana" } }), stubRemote(answer([])))),
    ).then((result) => {
      expect(Result.isFailure(result) && result.failure.message).toStartWith("Grafana answered 401")
    }))

  test("draws a firing alert's chart from its rule, for its own labels and not Grafana's", () => {
    const calls: Call[] = []
    const firing: SourcedAlert = {
      id: "g",
      name: "OrdersSlow",
      state: "firing",
      severity: "warning",
      startsAt: "2026-10-03T11:46:00Z",
      labels,
    }
    const read = readMetrics(
      "http://prometheus",
      grafanaRules(grafana),
      { environments: [], services: [] },
      [],
      [],
      [firing],
      Date.parse("2026-10-03T12:00:00Z"),
    )
    return Effect.runPromise(Effect.provide(read, stubRemote(answer(calls)))).then((metrics) => {
      expect(metrics.charts["g"]?.threshold).toBe(0.15)
      expect(metrics.charts["g"]?.points.at(-1)).toBe(0.2)
    })
  })

  test("leaves charts without thresholds when its ruler cannot be read", () =>
    Effect.runPromise(Effect.provide(grafanaRules({ url: "http://grafana" }), stubRemote(answer([])))).then((rules) => {
      expect(rules.size).toBe(0)
    }))

  test("takes silences written on the page", () => {
    const calls: Call[] = []
    const alert: SourcedAlert = {
      id: "a1",
      name: "OrdersSlow",
      state: "firing",
      severity: "warning",
      startsAt: "t",
      labels,
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(
          {
            ...settings({ anonymous: { name: "gil", role: "operator" } }),
            sources: { staging: { grafana }, production: {} },
          },
          estate({
            environments: {
              staging: environment({ alerts: { state: "ok", value: [alert] } }),
              production: environment(),
            },
          }),
          answer(calls),
        )
        const answered = yield* ask(
          server,
          new Request("http://estate/api/silences", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ environment: "staging", alert: "a1", minutes: 60, reason: "vacuum" }),
          }),
        )
        expect(answered.status).toBe(201)
        expect(calls[0]?.url).toBe("http://grafana/api/alertmanager/grafana/api/v2/silences")
        const { environments } = yield* SubscriptionRef.get(yield* Effect.provide(Estate, server.context))
        expect(environments["staging"]?.alerts.value?.[0]?.silence?.id).toBe("g1")
      }),
    )
  })
})
