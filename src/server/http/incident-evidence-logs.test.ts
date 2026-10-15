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
const masked = {
  ...catalog,
  services: catalog.services.map((service) =>
    service.name === "orders" ? { ...service, logs: { mask: ["card \\d{4}"] } } : service,
  ),
}
const firing = estate({
  catalog: masked,
  environments: { staging: environment({ alerts: { state: "ok", value: [slow] } }) },
})
const sources = { staging: { loki: { url: "http://loki/" } }, production: {} }
const as = (role: "operator" | "viewer", lines?: number): Settings => ({
  ...settings({ anonymous: { name: role === "operator" ? "gil" : "vi", role }, logs: "operator" }),
  sources,
  ...(lines === undefined ? {} : { incidents: { evidence: { lines } } }),
})

// Two errors among five lines, the oldest first, as Loki gives them by nanosecond.
const said: ReadonlyArray<readonly [number, string]> = [
  [1, "INFO started"],
  [2, "ERROR pool exhausted for card 4242"],
  [3, "INFO retrying"],
  [4, "ERROR pool exhausted for card 4343"],
  [5, "INFO recovered"],
]
const loki = (call: Call): Reply | undefined => {
  if (!call.url.startsWith("http://loki/loki/api/v1/query_range")) return undefined
  const start = Date.parse("2026-10-12T16:50:00Z")
  const values = said.map(([minute, text]) => [`${start + minute * 60_000}000000`, text])
  return reply({ data: { result: [{ stream: { pod: "orders-1" }, values }] } })
}

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** An incident on the orders firing, closed by an operator, as `reader` then reads it. */
const closed = (lines: number | undefined, reader: "operator" | "viewer" = "operator") =>
  Effect.gen(function* () {
    const server = yield* serverFor(as("operator", lines), firing, loki)
    const incident = (yield* ask(
      server,
      sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
    )).json() as Incident
    const ended = (yield* ask(
      server,
      sending("POST", `/api/incidents/${incident.id}/close`, { how: "resized the pool" }),
    )).json() as Incident
    // A viewer of the same store, with the closed incident in its state.
    const shared = Layer.succeed(Notes)(Context.get(server.context, Notes))
    const reading =
      reader === "operator"
        ? server
        : yield* serverFor(as("viewer", lines), { ...firing, incidents: [ended] }, loki, shared)
    return (yield* ask(reading, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
  })

describe("an incident's logs, kept as evidence", () => {
  test("keep each service's errors grouped by message, and its lines, masked as on the page", () =>
    Effect.runPromise(closed(undefined)).then((record) => {
      const [logs] = record.evidence?.at(-1)?.logs ?? []
      expect([logs?.service, logs?.from, logs?.leftOut]).toEqual(["orders", "Loki", 0])
      expect(logs?.errors.map((group) => [group.count, group.examples[0]?.text])).toEqual([
        [2, "ERROR pool exhausted for •••"],
      ])
      expect(logs?.lines.map((line) => line.text)).toEqual([
        "INFO started",
        "ERROR pool exhausted for •••",
        "INFO retrying",
        "ERROR pool exhausted for •••",
        "INFO recovered",
      ])
      const kept = record.events.find((each) => each.kind === "evidence-kept")
      expect(kept?.text).toBe("kept 1 service's charts, 0 series, 5 lines")
    }))

  test("keep errors first and the newest lines, up to evidence.lines, and name the rest as left out", () =>
    Effect.runPromise(closed(3)).then((record) => {
      const [logs] = record.evidence?.at(-1)?.logs ?? []
      expect(logs?.lines.map((line) => line.text)).toEqual([
        "ERROR pool exhausted for •••",
        "ERROR pool exhausted for •••",
        "INFO recovered",
      ])
      expect(logs?.leftOut).toBe(2)
      const kept = record.events.find((each) => each.kind === "evidence-kept")
      expect(kept?.text).toBe(
        "kept 1 service's charts, 0 series, 3 lines; 2 lines left out past incidents.evidence.lines",
      )
    }))

  test("are left out for a reader who may not read logs here", () =>
    Effect.runPromise(closed(undefined, "viewer")).then((record) => {
      expect(record.evidence).toHaveLength(1)
      expect(record.evidence?.[0]?.logs).toBeUndefined()
    }))
})
