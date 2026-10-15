import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { EvidenceSet } from "../../shared/evidence"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { ask, environment, estate, serverFor, settings } from "../fixture"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"

const incident: Incident = {
  id: "i1",
  title: "Orders slow",
  openedBy: "gil",
  openedAt: "2026-10-12T16:50:00Z",
  firings: [],
}
const state = estate({ environments: { staging: environment(), production: environment() }, incidents: [incident] })
const sources = { staging: { tempo: { url: "http://tempo:3200" } }, production: {} }
const as = (role: "operator" | "viewer"): Settings => ({
  ...settings({ anonymous: { name: role === "operator" ? "gil" : "vi", role }, logs: "operator" }),
  sources,
})

const nanos = (millis: number) => String((1_760_288_000_000 + millis) * 1e6)
const span = { spanId: "a", name: "place order", startTimeUnixNano: nanos(0), endTimeUnixNano: nanos(9100) }
const whole = {
  batches: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: "storefront" } }] },
      scopeSpans: [{ spans: [span] }],
    },
  ],
}
const tempo = (call: Call): Reply | undefined => {
  const url = new URL(call.url)
  if (url.pathname === "/api/traces/t1") return reply(whole)
  if (url.pathname === "/api/traces/gone") return reply({ batches: [] })
  return undefined
}

const including = (body: unknown) =>
  new Request("http://estate/api/incidents/i1/included", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

describe("including a trace in an incident", () => {
  test("reads it whole from the environment's Tempo and keeps it, marked included, with why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("operator"), state, tempo)
        const answer = yield* ask(
          server,
          including({ kind: "trace", environment: "staging", id: "t1", journey: "order", why: "the slow one" }),
        )
        const record = (yield* ask(server, new Request("http://estate/api/incidents/i1"))).json() as IncidentRecord
        return { status: answer.status, kept: answer.json() as EvidenceSet, record }
      }),
    ).then(({ status, kept, record }) => {
      expect(status).toBe(201)
      expect(kept).toMatchObject({ from: "included", why: "the slow one", charts: [] })
      expect(kept.traces).toEqual([
        expect.objectContaining({ id: "t1", environment: "staging", why: "included", journey: "order" }),
      ])
      expect(kept.traces?.[0]?.spans).toHaveLength(1)
      expect(record.events.find((each) => each.kind === "included")?.text).toBe(
        'included trace t1 of order: "the slow one"',
      )
    }))

  test("is refused a trace Tempo does not have, and to someone who may not read logs", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const operator = yield* serverFor(as("operator"), state, tempo)
        const viewer = yield* serverFor(as("viewer"), state, tempo)
        const gone = yield* ask(operator, including({ kind: "trace", environment: "staging", id: "gone" }))
        const refused = yield* ask(viewer, including({ kind: "trace", environment: "staging", id: "t1" }))
        return [
          [gone.status, gone.json()],
          [refused.status, refused.json()],
        ]
      }),
    ).then((answers) => {
      expect(answers).toEqual([
        [404, { message: "trace gone is not in staging's Tempo" }],
        [403, { message: "lines and traces are included by those who may read them here" }],
      ])
    }))
})
