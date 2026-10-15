import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { ask, environment, estate, serverFor, settings } from "../fixture"
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
const firing = estate({ environments: { staging: environment({ alerts: { state: "ok", value: [slow] } }) } })
const kept = (maxMegabytes?: number): Settings => ({
  ...settings({ anonymous: { name: "gil", role: "operator" } }),
  sources: { staging: { loki: { url: "http://loki/" } }, production: {} },
  ...(maxMegabytes === undefined ? {} : { incidents: { evidence: { maxMegabytes } } }),
})

const start = Date.parse("2026-10-12T16:50:00Z")
const loki = (call: Call): Reply | undefined =>
  call.url.startsWith("http://loki/loki/api/v1/query_range")
    ? reply({
        data: {
          result: [
            {
              stream: { pod: "orders-1" },
              values: Array.from({ length: 20 }, (_, minute) => [
                `${start + minute * 60_000}000000`,
                `INFO ${"x".repeat(200)}`,
              ]),
            },
          ],
        },
      })
    : undefined
const lokiDown = (call: Call): Reply | undefined =>
  call.url.startsWith("http://loki/") ? reply("overloaded", 500) : undefined

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** An incident on the orders firing, closed, and what its last evidence and its event say. */
const closed = (configured: Settings, answer: (call: Call) => Reply | undefined) =>
  Effect.gen(function* () {
    const server = yield* serverFor(configured, firing, answer)
    const incident = (yield* ask(
      server,
      sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
    )).json() as Incident
    yield* ask(server, sending("POST", `/api/incidents/${incident.id}/close`, { how: "resized the pool" }))
    const record = (yield* ask(server, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
    return { set: record.evidence?.at(-1), said: record.events.find((each) => each.kind === "evidence-kept")?.text }
  })

describe("an incident's evidence and its limit", () => {
  test("keeps within incidents.evidence.maxMegabytes, and its event names what was left out", () =>
    Effect.runPromise(closed(kept(0.002), loki)).then(({ set, said }) => {
      const lines = set?.logs?.[0]?.lines.length ?? 0
      expect(lines).toBeGreaterThan(0)
      expect(lines).toBeLessThan(20)
      expect(set?.leftOut).toEqual([`${20 - lines} lines past incidents.evidence.maxMegabytes`])
      expect(said).toEndWith(`; left out: ${20 - lines} lines past incidents.evidence.maxMegabytes`)
    }))

  test("names a source that did not answer, even when it is all there was to read", () =>
    Effect.runPromise(closed(kept(), lokiDown)).then(({ set, said }) => {
      expect(set?.logs).toEqual([])
      expect(set?.leftOut).toEqual(["the logs of orders in staging: Loki answered 500: overloaded"])
      expect(said).toBe(
        "kept 0 services' charts, 0 series; left out: the logs of orders in staging: Loki answered 500: overloaded",
      )
    }))
})
