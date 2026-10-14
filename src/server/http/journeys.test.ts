import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import { type Call, reply } from "../remote"

const withJourney = {
  ...catalog,
  map: { nodes: [{ id: "db", title: "Orders DB", kind: "external" as const }], edges: [] },
  journeys: [
    {
      name: "order",
      title: "Placing an order",
      environments: ["production"],
      start: { service: "storefront", span: "place order" },
      stages: [
        { title: "Taken", where: "orders", span: "POST /orders" },
        { title: "Waits to be written", where: "db", from: { end: "POST /orders" }, to: { start: "INSERT" } },
      ],
    },
  ],
}

const configured = (tempo: boolean) => ({
  ...settings({ anonymous: { name: "gil", role: "viewer" } }),
  sources: { staging: {}, production: tempo ? { tempo: { url: "http://tempo:3200" } } : {} },
})

const nanos = (millis: number) => String(millis * 1e6)
const spanOf = (id: string, name: string, from: number, to: number, parent?: string) => ({
  spanId: id,
  ...(parent === undefined ? {} : { parentSpanId: parent }),
  name,
  startTimeUnixNano: nanos(1_000_000 + from),
  endTimeUnixNano: nanos(1_000_000 + to),
})
const batch = (service: string, spans: ReadonlyArray<unknown>) => ({
  resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
  scopeSpans: [{ spans }],
})
const order = (wait: number) => ({
  batches: [
    batch("storefront", [spanOf("a", "place order", 0, 20)]),
    batch("orders", [spanOf("b", "POST /orders", 2, 18, "a"), spanOf("c", "INSERT", 18 + wait, 19 + wait, "b")]),
  ],
})

const tempo = (call: Call) => {
  const url = new URL(call.url)
  if (url.pathname === "/api/search") return reply({ traces: [{ traceID: "t1" }, { traceID: "t2" }] })
  if (url.pathname === "/api/traces/t1") return reply(order(100))
  if (url.pathname === "/api/traces/t2") return reply(order(300))
  return undefined
}

const get = (path: string) => new Request(`http://estate${path}`)

describe("a journey's sample", () => {
  test("is read from Tempo's recent traces; without Tempo it is not found, and a failing Tempo says why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answering = yield* serverFor(configured(true), estate({ catalog: withJourney }), tempo)
        const failing = yield* serverFor(configured(true), estate({ catalog: withJourney }), () => reply("down", 500))
        const bare = yield* serverFor(configured(false), estate({ catalog: withJourney }))
        const sample = yield* ask(answering, get("/api/journeys?env=production&journey=order"))
        return [
          sample.status,
          sample.json(),
          ...[
            yield* ask(answering, get("/api/journeys?env=staging&journey=order")),
            yield* ask(bare, get("/api/journeys?env=production&journey=order")),
            yield* ask(failing, get("/api/journeys?env=production&journey=order")),
          ].map((answer) => [answer.status, answer.json()]),
        ]
      }),
    ).then(([status, sample, staging, bare, failing]) => {
      expect(status).toBe(200)
      expect(sample).toMatchObject({
        name: "order",
        title: "Placing an order",
        minutes: 15,
        sampled: 2,
        stages: [
          { title: "Taken", where: { id: "orders", title: "orders" }, kind: "span", found: 2, p50: 16, p99: 16 },
          { title: "Waits to be written", where: { id: "db", title: "Orders DB" }, kind: "gap", p50: 100, p99: 300 },
        ],
        examples: [
          { why: "slowest", id: "t2" },
          { why: "typical", id: "t1" },
        ],
      })
      expect(staging).toEqual([404, { message: "order has no traces to read in staging" }])
      expect(bare).toEqual([404, { message: "order has no traces to read in production" }])
      expect(failing).toEqual([502, { message: "Tempo answered 500: down" }])
    }))
})

describe("a trace", () => {
  test("is read whole as lanes and rows, measured as the journey asked for; one Tempo lacks is not found", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured(true), estate({ catalog: withJourney }), tempo)
        return [
          yield* ask(server, get("/api/traces/t2?env=production&journey=order")),
          yield* ask(server, get("/api/traces/gone?env=production")),
        ].map((answer) => [answer.status, answer.json()])
      }),
    ).then(([found, gone]) => {
      expect(found?.[0]).toBe(200)
      expect(found?.[1]).toMatchObject({
        id: "t2",
        journey: { name: "order" },
        answered: 20,
        total: 319,
        lanes: [{ id: "storefront" }, { id: "orders" }, { id: "db", title: "Orders DB" }],
        cut: { from: 18, to: 318 },
      })
      expect(gone).toEqual([502, { message: "Tempo answered 404: not found" }])
    }))
})
