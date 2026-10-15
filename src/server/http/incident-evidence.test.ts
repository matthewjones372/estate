import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"
import type { SourcedAlert } from "../state"

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-12T16:47:58Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}
const load = {
  requests: "sum(rate(orders_total[1m]))",
  errors: "sum(rate(orders_errors[1m]))",
  p99: "histogram_quantile(0.99, x)",
}
const measured = {
  ...catalog,
  stores: [{ name: "orders-db", environments: ["staging"], engine: "redis" as const, selector: 'app="orders"' }],
  services: catalog.services.map((service) =>
    service.name === "orders"
      ? { ...service, load, stats: { extra: [{ title: "Queue", query: "sum(queue)" }] } }
      : service,
  ),
}
const firing = estate({
  catalog: measured,
  environments: { staging: environment({ alerts: { state: "ok", value: [slow] } }) },
})
const sources = { staging: { prometheus: { url: "http://prometheus/" } }, production: {} }
const operator: Settings = { ...settings({ anonymous: { name: "gil", role: "operator" } }), sources }
const viewer: Settings = { ...settings({ anonymous: { name: "vi", role: "viewer" } }), sources }

/** Prometheus as a stub: each range answers two points at its end. */
const prometheus = (call: Call): Reply | undefined => {
  const url = new URL(call.url)
  if (url.pathname !== "/api/v1/query_range") return undefined
  const [end, step] = [Number(url.searchParams.get("end")), Number(url.searchParams.get("step"))]
  return reply({
    data: {
      result: [
        {
          metric: {},
          values: [
            [end - step, "4"],
            [end, "5"],
          ],
        },
      ],
    },
  })
}

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** An incident opened on the orders firing, kept now `now` times, then closed; its record as read after. */
const keptAndClosed = (now: number) =>
  Effect.gen(function* () {
    const server = yield* serverFor(operator, firing, prometheus)
    const incident = (yield* ask(
      server,
      sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
    )).json() as Incident
    yield* ask(server, sending("POST", `/api/incidents/${incident.id}/services`, { service: "orders-db" }))
    const keeps = yield* Effect.forEach(Array.from({ length: now }), () =>
      ask(server, sending("POST", `/api/incidents/${incident.id}/evidence`)),
    )
    yield* ask(server, sending("POST", `/api/incidents/${incident.id}/close`, { how: "resized the pool" }))
    const record = (yield* ask(server, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
    return { statuses: keeps.map((each) => each.status), record }
  })

describe("an incident's charts, kept as evidence", () => {
  test("are kept on close: each service's Load and stats, over its window, with the query each came from", () =>
    Effect.runPromise(keptAndClosed(0)).then(({ record }) => {
      const [set] = record.evidence ?? []
      expect(record.evidence).toHaveLength(1)
      expect(set?.keptBy).toBe("Estate")
      const orders = set?.charts.filter((chart) => chart.service === "orders") ?? []
      const store = set?.charts.filter((chart) => chart.service === "orders-db") ?? []
      expect(store.length).toBeGreaterThan(0)
      expect(store.every((chart) => chart.query !== "" && chart.points.at(-1) === 5)).toBe(true)
      expect(orders.map((chart) => [chart.service, chart.panel, chart.query, chart.points.at(-1)])).toEqual([
        ["orders", "requests", load.requests, 5],
        ["orders", "errors", load.errors, 5],
        ["orders", "p99", load.p99, 5],
        ["orders", "Queue", "sum(queue)", 5],
      ])
      expect(set?.charts.every((chart) => chart.points.length < 600)).toBe(true)
      expect(set?.window.start).toBeLessThanOrEqual(Date.parse("2026-10-12T16:17:58Z") / 1000)
      const kept = record.events.filter((each) => each.kind === "evidence-kept").map((each) => [each.by, each.text])
      expect(kept).toEqual([["Estate", `kept 2 services' charts, ${4 + store.length} series`]])
    }))

  test("are kept again by an operator while it is open, each keep a set beside the last", () =>
    Effect.runPromise(keptAndClosed(1)).then(({ statuses, record }) => {
      expect(statuses).toEqual([201])
      expect(record.evidence?.map((each) => each.keptBy)).toEqual(["gil", "Estate"])
    }))

  test("are kept now only by an operator", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(viewer, firing, prometheus)
        return (yield* ask(server, sending("POST", "/api/incidents/i1/evidence"))).status
      }),
    ).then((status) => expect(status).toBe(403)))
})
