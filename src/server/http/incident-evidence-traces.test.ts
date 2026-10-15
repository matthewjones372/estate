import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import { Notes } from "../notes"
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
const withJourney = {
  ...catalog,
  journeys: [
    {
      name: "order",
      title: "Placing an order",
      environments: ["staging"],
      start: { service: "storefront", span: "place order" },
      stages: [{ title: "Taken", where: "orders", span: "POST /orders" }],
    },
  ],
}
const firing = estate({
  catalog: withJourney,
  environments: { staging: environment({ alerts: { state: "ok", value: [slow] } }) },
})
const sources = { staging: { tempo: { url: "http://tempo:3200" }, loki: { url: "http://loki/" } }, production: {} }
const as = (role: "operator" | "viewer"): Settings => ({
  ...settings({ anonymous: { name: role === "operator" ? "gil" : "vi", role }, logs: "operator" }),
  sources,
})

const nanos = (millis: number) => String((1_760_288_000_000 + millis) * 1e6)
const trace = (took: number, failed = false) => ({
  batches: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: "storefront" } }] },
      scopeSpans: [
        {
          spans: [
            {
              spanId: "a",
              name: "place order",
              startTimeUnixNano: nanos(0),
              endTimeUnixNano: nanos(took),
              ...(failed ? { status: { code: 2 } } : {}),
            },
          ],
        },
      ],
    },
  ],
})
const traces: Readonly<Record<string, unknown>> = { t1: trace(20), t2: trace(900), t3: trace(40, true), t9: trace(60) }

/** Tempo finds three traces of the journey and holds one more, which a log line names; Loki has that line. */
const sourcesUp = (call: Call): Reply | undefined => {
  const url = new URL(call.url)
  if (url.pathname === "/api/search")
    return reply({ traces: [{ traceID: "t1" }, { traceID: "t2" }, { traceID: "t3" }] })
  const id = /^\/api\/traces\/(\w+)$/.exec(url.pathname)?.[1]
  if (id !== undefined && id in traces) return reply(traces[id])
  if (call.url.startsWith("http://loki/loki/api/v1/query_range"))
    return reply({
      data: {
        result: [
          {
            stream: { pod: "orders-1" },
            values: [[`${Date.parse("2026-10-12T16:50:00Z")}000000`, '{"level":"error","msg":"slow","trace_id":"t9"}']],
          },
        ],
      },
    })
  return undefined
}
const tempoStopped = () => reply("connection refused", 503)

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** An incident on the orders firing, closed while the sources answer; then read with them stopped, as `role`. */
const closedThenStopped = (role: "operator" | "viewer") =>
  Effect.gen(function* () {
    const server = yield* serverFor(as("operator"), firing, sourcesUp)
    const incident = (yield* ask(
      server,
      sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
    )).json() as Incident
    const ended = (yield* ask(
      server,
      sending("POST", `/api/incidents/${incident.id}/close`, { how: "resized the pool" }),
    )).json() as Incident
    const shared = Layer.succeed(Notes)(Context.get(server.context, Notes))
    const stopped = yield* serverFor(as(role), { ...firing, incidents: [ended] }, tempoStopped, shared)
    const record = (yield* ask(stopped, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
    const opened = yield* ask(stopped, sending("GET", "/api/traces/t2?env=staging&journey=order"))
    return { record, opened: [opened.status, (opened.json() as { id?: string }).id] }
  })

describe("an incident's traces, kept as evidence", () => {
  test("keep its journeys' slowest and failed traces and those its lines name, and open with Tempo stopped", () =>
    Effect.runPromise(closedThenStopped("operator")).then(({ record, opened }) => {
      const kept = record.evidence?.at(-1)?.traces ?? []
      expect(kept.map((each) => [each.id, each.why, each.journey])).toEqual([
        ["t2", "slowest", "order"],
        ["t1", "slowest", "order"],
        ["t3", "failed", "order"],
        ["t9", "named", undefined],
      ])
      expect(kept[0]?.spans[0]?.name).toBe("place order")
      expect(opened).toEqual([200, "t2"])
      const said = record.events.find((each) => each.kind === "evidence-kept")?.text
      expect(said).toBe("kept 1 service's charts, 0 series, 1 line, 4 traces")
    }))

  test("are left out for a reader who may not read logs here", () =>
    Effect.runPromise(closedThenStopped("viewer")).then(({ record }) => {
      expect(record.evidence?.at(-1)?.traces).toBeUndefined()
    }))

  test("keep what Tempo gives when its search fails; a trace no incident kept still needs Tempo", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const searchDown = (call: Call): Reply | undefined =>
          new URL(call.url).pathname === "/api/search" ? reply("down", 500) : sourcesUp(call)
        const server = yield* serverFor(as("operator"), firing, searchDown)
        const incident = (yield* ask(
          server,
          sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
        )).json() as Incident
        yield* ask(server, sending("POST", `/api/incidents/${incident.id}/close`, { how: "resized the pool" }))
        const missing = yield* ask(server, sending("GET", "/api/traces/t7?env=staging"))
        const record = (yield* ask(server, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
        return { record, missing: missing.status }
      }),
    ).then(({ record, missing }) => {
      expect(record.evidence?.at(-1)?.traces?.map((each) => [each.id, each.why])).toEqual([["t9", "named"]])
      // Tempo could not answer for it and no incident kept it, so it is Tempo's failure, as before.
      expect(missing).toBe(502)
    }))
})
