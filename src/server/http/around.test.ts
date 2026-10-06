import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import type { Catalog } from "../../shared/catalog"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import { type Call, reply } from "../remote"
import type { EstateState, SourcedAlert } from "../state"

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })
const series = (now: number) => ({ now, points: [now] })

const withStore: Catalog = {
  ...catalog,
  stores: [{ name: "orders-db", environments: ["production"], engine: "postgres", selector: 'db="orders"' }],
  map: {
    nodes: [...(catalog.map?.nodes ?? []).filter((node) => node.id !== "db"), { id: "db", store: "orders-db" }],
    edges: catalog.map?.edges ?? [],
  },
}

const slow: SourcedAlert = {
  id: "OrdersSlow-1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-03T11:00:00Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
  runbook: "https://wiki.example/runbooks/orders",
}

const state = (): EstateState =>
  estate({
    catalog: withStore,
    environments: {
      staging: environment(),
      production: environment({
        alerts: ok([slow]),
        deploys: ok({
          orders: { version: "main-88-04bc441", ready: true, at: "2026-10-03T10:58:00Z" },
          payments: { version: "main-40-aa", ready: true, at: "2026-10-02T09:00:00Z" },
        }),
        metrics: ok({
          services: { payments: { requests: series(11) } },
          stores: { "orders-db": [{ key: "connections", title: "connections", unit: "%", series: series(92) }] },
          vitals: [],
          edges: [],
          charts: {},
        }),
      }),
    },
    builds: ok({
      storefront: [
        { sha: "a", title: "Faster basket", status: "success", at: "2026-10-03T10:30:00Z", url: "https://ci/1" },
        { sha: "b", title: "Old", status: "success", at: "2026-10-03T08:00:00Z", url: "https://ci/0" },
      ],
    }),
    firings: [
      {
        environment: "production",
        alert: "OrdersSlow-1",
        name: "OrdersSlow",
        startsAt: "2026-09-27T09:10:00Z",
        endsAt: "2026-09-27T09:32:00Z",
      },
    ],
    notes: [
      {
        id: "n1",
        environment: "production",
        alert: "OrdersSlow-1",
        at: "2026-09-27T09:20:00Z",
        by: "ada",
        text: "vacuumed the orders table",
      },
    ],
  })

const configured = (role: "viewer" | "operator", logs?: "operator") => ({
  ...settings({ anonymous: { name: "gil", role }, ...(logs === undefined ? {} : { logs }) }),
  sources: { staging: {}, production: { loki: { url: "http://loki" } } },
  runbooks: [{ host: "wiki.example", user: "estate", token: Redacted.make("t0ken") }],
})

const tools = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.url.startsWith("http://loki/"))
    return reply({
      status: "success",
      data: {
        resultType: "streams",
        result: [{ stream: { pod: "orders-1" }, values: [[`${Date.now() - 1000}000000`, "ERROR lock timeout on 7"]] }],
      },
    })
  if (call.url === "https://wiki.example/runbooks/orders")
    return reply("<html><body><h1>Orders</h1><p>If p99 is high after a deploy, roll back.</p></body></html>", 200, {
      "Content-Type": "text/html; charset=utf-8",
    })
  return undefined
}

const around = (alert = "OrdersSlow-1", env = "production") =>
  new Request(`http://estate/api/alerts/${alert}/around?env=${env}`)

describe("around an alert", () => {
  test("is what changed near it, what it depends on, its errors, its history and its runbook's text", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.flatMap(serverFor(configured("viewer"), state(), tools(calls)), (server) => ask(server, around())),
    ).then((answer) => {
      expect(answer.status).toBe(200)
      const brief = answer.json() as Record<string, unknown>
      expect(brief["subject"]).toBe("orders")
      expect(brief["changed"]).toEqual([
        { at: "2026-10-03T10:58:00Z", service: "orders", kind: "deploy", text: "main-88-04bc441 deployed" },
        {
          at: "2026-10-03T10:30:00Z",
          service: "storefront",
          kind: "build",
          text: "build passed: Faster basket",
          url: "https://ci/1",
        },
      ])
      expect(brief["depends"]).toEqual([
        expect.objectContaining({ name: "storefront", kind: "service", side: "called by" }),
        expect.objectContaining({
          name: "payments",
          side: "calls",
          readings: [{ title: "requests", now: 11, unit: "/s" }],
        }),
        expect.objectContaining({
          name: "orders-db",
          kind: "store",
          side: "calls",
          readings: [{ title: "connections", now: 92, unit: "%" }],
        }),
      ])
      expect(brief["errors"]).toEqual(
        expect.objectContaining({ groups: [expect.objectContaining({ count: 1, pods: ["orders-1"] })] }),
      )
      expect(brief["before"]).toEqual([
        {
          startsAt: "2026-09-27T09:10:00Z",
          endsAt: "2026-09-27T09:32:00Z",
          notes: [{ by: "ada", at: "2026-09-27T09:20:00Z", text: "vacuumed the orders table" }],
        },
      ])
      expect(brief["runbook"]).toEqual({
        url: "https://wiki.example/runbooks/orders",
        text: "Orders\nIf p99 is high after a deploy, roll back.",
      })
      expect(calls.find((call) => call.url.startsWith("https://wiki"))?.headers?.["authorization"]).toBe(
        `Basic ${btoa("estate:t0ken")}`,
      )
    })
  })

  test("leaves out errors a viewer may not read, and is not found for an alert that is not there", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured("viewer", "operator"), state(), tools([]))
        const kept = yield* ask(server, around())
        const missing = yield* ask(server, around("Nothing-1"))
        const elsewhere = yield* ask(server, new Request("http://estate/api/alerts/OrdersSlow-1/around?env=nowhere"))
        return { kept: kept.json() as Record<string, unknown>, missing, elsewhere }
      }),
    ).then(({ kept, missing, elsewhere }) => {
      expect(kept["errors"]).toBeUndefined()
      expect([missing.status, missing.json()]).toEqual([404, { message: "there is no alert Nothing-1 in production" }])
      expect(elsewhere.status).toBe(404)
    }))
})
