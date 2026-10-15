import { describe, expect, test } from "bun:test"
import { Context, Effect } from "effect"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import type { Pod } from "../../shared/workloads"
import { ask, environment, estate, type Server, serverFor, settings } from "../fixture"
import { Notes } from "../notes"
import type { Chosen, SourcedAlert } from "../state"

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-12T16:47:58Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}
const down: SourcedAlert = {
  ...slow,
  id: "a2",
  name: "PaymentsDown",
  labels: { alertname: "PaymentsDown", app: "payments" },
}
const pod = (name: string, image: string, more: Partial<Pod> = {}): Pod => ({
  name,
  phase: "Running",
  ready: true,
  restarts: 0,
  image,
  ...more,
})
const pods = {
  orders: [
    pod("orders-1", "shop/orders:2.1.0", { restarts: 2, lastTermination: "OOMKilled" }),
    pod("orders-2", "shop/orders:2.1.0"),
  ],
  payments: [pod("payments-1", "shop/payments:3.0.0")],
}
const holding = (chosen: Chosen) =>
  estate({
    environments: {
      staging: environment({
        alerts: { state: "ok", value: [slow, down] },
        cluster: { state: "ok", value: { pods, debug: {} } },
        deploys: { state: "ok", value: { orders: chosen } },
      }),
      production: environment(),
    },
    builds: {
      state: "ok",
      value: {
        orders: [
          {
            sha: "b2",
            title: "main-212",
            status: "failure",
            at: "2026-10-12T16:30:00.000Z",
            url: "https://ci/212",
            job: "test",
          },
          { sha: "b1", title: "main-211", status: "success", at: "2026-10-12T15:00:00.000Z", url: "https://ci/211" },
        ],
      },
    },
  })
const operator = settings({ anonymous: { name: "gil", role: "operator" } })

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** An incident opened on the orders firing, `then` done to it, and its own events as kept. */
const opened = (chosen: Chosen, then: (server: Server, id: string) => Effect.Effect<unknown> = () => Effect.void) =>
  Effect.gen(function* () {
    const server = yield* serverFor(operator, holding(chosen))
    const incident = (yield* ask(
      server,
      sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
    )).json() as Incident
    yield* then(server, incident.id)
    const events = yield* Context.get(server.context, Notes).incidentEvents(incident.id)
    return events.map((each) => [each.at, each.kind, each.text, each.service, each.source])
  })

// The window starts 30 minutes before the firing at 16:47:58.
const start = "2026-10-12T16:17:58.000Z"

describe("an incident's run-up, rebuilt from what Estate holds", () => {
  test("keeps a deploy and a build in its window as rebuilt, and says the version before it is not known here", () =>
    Effect.runPromise(opened({ version: "2.1.0", ready: true, at: "2026-10-12T16:37:58.000Z" })).then((events) => {
      // The build before the window is not kept; restarts are as Estate holds them now.
      expect(events.slice(0, 3)).toEqual([
        [start, "version-seen", "the version of orders before 2.1.0 is not known here", "orders", "rebuilt"],
        ["2026-10-12T16:30:00.000Z", "build", "orders main-212 failed at test", "orders", "rebuilt"],
        ["2026-10-12T16:37:58.000Z", "deployed", "orders 2.1.0 deployed in staging", "orders", "rebuilt"],
      ])
      expect(events.slice(3).map((each) => each.slice(1))).toEqual([
        ["restarted", "orders-1 restarted (OOMKilled), 2 restarts", "orders", "rebuilt"],
      ])
    }))

  test("says the version running at its start when the latest deploy is older", () =>
    Effect.runPromise(opened({ version: "2.1.0", ready: true, at: "2026-10-12T09:00:00.000Z" })).then((events) => {
      expect(events[0]).toEqual([start, "version-seen", "orders 2.1.0 running in staging", "orders", "rebuilt"])
      expect(events.some((each) => each[1] === "deployed")).toBe(false)
    }))

  test("is rebuilt for a service that joins it, and only that service", () =>
    Effect.runPromise(
      opened({ version: "2.1.0", ready: true, at: "2026-10-12T09:00:00.000Z" }, (server, id) =>
        ask(server, sending("POST", `/api/incidents/${id}/firings`, { environment: "staging", alert: "a2" })),
      ),
    ).then((events) => {
      expect(events.filter((each) => each[3] === "payments")).toEqual([
        [start, "version-seen", "payments 3.0.0 running in staging", "payments", "rebuilt"],
      ])
      expect(events.filter((each) => each[1] === "version-seen" && each[3] === "orders")).toHaveLength(1)
    }))

  test("closing keeps each service's version, and the incident says what changed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(
          operator,
          holding({ version: "2.1.0", ready: true, at: "2026-10-12T09:00:00.000Z" }),
        )
        const incident = (yield* ask(
          server,
          sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
        )).json() as Incident
        yield* ask(server, sending("POST", `/api/incidents/${incident.id}/close`, { how: "the pool was resized" }))
        return (yield* ask(server, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
      }),
    ).then((record) => {
      expect(
        record.events.filter((each) => each.kind === "version-seen").map((each) => [each.text, each.source]),
      ).toEqual([
        ["orders 2.1.0 running in staging", "rebuilt"],
        ["orders 2.1.0 running in staging", "seen"],
      ])
      expect(record.versions).toEqual([
        { service: "orders", environment: "staging", start: "2.1.0", changes: [], close: "2.1.0" },
      ])
    }))
})
