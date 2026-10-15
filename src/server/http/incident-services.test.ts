import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { ask, environment, estate, serverFor, settings } from "../fixture"
import type { Settings } from "../settings"
import type { SourcedAlert } from "../state"

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-12T16:47:58Z",
  labels: { alertname: "OrdersSlow", service: "orders" },
}
const firing = estate({ environments: { staging: environment({ alerts: { state: "ok", value: [slow] } }) } })
const operator = settings({ anonymous: { name: "gil", role: "operator" } })
const viewer = settings({ anonymous: { name: "vi", role: "viewer" } })

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** An incident opened on the orders firing, then `then` asked of it by whoever `as` is. */
const opened = <A>(
  as: Settings,
  then: (id: string, server: Effect.Success<ReturnType<typeof serverFor>>) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const server = yield* serverFor(as, firing)
    const incident = (yield* ask(
      server,
      sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
    )).json() as Incident
    return yield* then(incident.id, server)
  })

const recordOf = (server: Effect.Success<ReturnType<typeof serverFor>>, id: string) =>
  Effect.map(ask(server, sending("GET", `/api/incidents/${id}`)), (answer) => answer.json() as IncidentRecord)

describe("an incident's services", () => {
  test("are the services of its firings", () =>
    Effect.runPromise(opened(operator, (id, server) => recordOf(server, id))).then((record) => {
      expect(record.services).toEqual(["orders"])
    }))

  test("gain one an operator adds, which is an event on the incident", () =>
    Effect.runPromise(
      opened(operator, (id, server) =>
        Effect.gen(function* () {
          const added = yield* ask(server, sending("POST", `/api/incidents/${id}/services`, { service: "payments" }))
          return { status: added.status, record: yield* recordOf(server, id) }
        }),
      ),
    ).then(({ status, record }) => {
      expect(status).toBe(201)
      expect(record.services).toEqual(["orders", "payments"])
      const event = record.events.find((each) => each.kind === "service-added")
      expect([event?.by, event?.text, event?.service, event?.alert]).toEqual(["gil", "payments", "payments", undefined])
    }))

  test("refuse one the catalog does not name, or one it has, saying why", () =>
    Effect.runPromise(
      opened(operator, (id, server) =>
        Effect.all(
          ["nowhere", "orders"].map((service) =>
            Effect.map(ask(server, sending("POST", `/api/incidents/${id}/services`, { service })), (answer) => [
              answer.status,
              (answer.json() as { message: string }).message,
            ]),
          ),
        ),
      ),
    ).then((answers) => {
      expect(answers).toEqual([
        [400, "the catalog names no service or store nowhere"],
        [400, '"Orders slow" already has orders'],
      ])
    }))

  test("are added to only by an operator", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(viewer, firing)
        return (yield* ask(server, sending("POST", "/api/incidents/i1/services", { service: "payments" }))).status
      }),
    ).then((status) => expect(status).toBe(403)))
})

describe("an incident's window", () => {
  test("starts 30 minutes before its first firing, and runs to now while it is open", () =>
    Effect.runPromise(opened(operator, (id, server) => recordOf(server, id))).then((record) => {
      expect(record.window?.from).toBe("2026-10-12T16:17:58.000Z")
      expect(Date.parse(record.window?.to ?? "")).toBeGreaterThan(Date.parse(slow.startsAt))
    }))

  test("starts as far before as incidents.leadMinutes says", () =>
    Effect.runPromise(
      opened({ ...operator, incidents: { leadMinutes: 10 } }, (id, server) => recordOf(server, id)),
    ).then((record) => expect(record.window?.from).toBe("2026-10-12T16:37:58.000Z")))
})
