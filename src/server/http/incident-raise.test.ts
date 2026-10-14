import { describe, expect, test } from "bun:test"
import { Context, Effect, Redacted, SubscriptionRef } from "effect"
import type { Me } from "../../shared/events"
import type { Incident } from "../../shared/incidents"
import { ask, catalog, environment, estate, type Server, serverFor, settings } from "../fixture"
import { Notes } from "../notes"
import { type Call, reply } from "../remote"
import { Estate, type SourcedAlert } from "../state"

const firing = (id: string, name: string, severity: string, service: string): SourcedAlert => ({
  id,
  name,
  state: "firing",
  severity,
  startsAt: "2026-10-12T16:47:58Z",
  labels: { alertname: name, service },
})
const firings = estate({
  catalog: {
    ...catalog,
    services: catalog.services.map((each) => (each.name === "payments" ? { ...each, owner: "payments" } : each)),
    teams: [{ name: "payments", incidentTool: { pagerduty: "PDEF456" } }],
  },
  environments: {
    staging: environment({ alerts: { state: "ok", value: [firing("a1", "SearchSlow", "warning", "search")] } }),
    production: environment({ alerts: { state: "ok", value: [firing("a3", "PaymentsDown", "critical", "payments")] } }),
  },
})

const pagerduty = { token: Redacted.make("pd-key"), from: "estate@example.com", service: "PABC123" }
const withTool = { ...settings({ anonymous: { name: "gil", role: "operator" } }), incidentTool: { pagerduty } }
const viewer = { ...withTool, auth: { ...withTool.auth, anonymous: { name: "vi", role: "viewer" as const } } }

const url = "https://example.pagerduty.com/incidents/Q1ABC"

/** PagerDuty's REST API, counting the incidents it is asked to make. */
const pagerDuty = (posts: Call[]) => (call: Call) => {
  if (call.method !== "POST") return reply({ incidents: [] })
  posts.push(call)
  return reply({ incident: { id: "Q1ABC", html_url: url } }, 201)
}

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const opened = (server: Server, alert = "a3", environment = "production") =>
  Effect.map(
    ask(server, sending("POST", "/api/incidents", { title: "Payments down", environment, alert })),
    (answered) => answered.json() as Incident,
  )

const raise = (server: Server, id: string) => ask(server, sending("POST", `/api/incidents/${id}/raise`))

describe("raising an incident in the incident tool", () => {
  test("keeps the tool's link and who raised it, leaves an event on each firing, and raises it once", () => {
    const posts: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withTool, firings, pagerDuty(posts))
        const incident = yield* opened(server)
        yield* ask(
          server,
          sending("POST", `/api/incidents/${incident.id}/firings`, { environment: "staging", alert: "a1" }),
        )
        const first = yield* raise(server, incident.id)
        const again = yield* raise(server, incident.id)
        const kept = (yield* SubscriptionRef.get(Context.get(server.context, Estate))).incidents ?? []
        const events = yield* Effect.forEach(
          [
            { environment: "production", alert: "a3" },
            { environment: "staging", alert: "a1" },
          ],
          (one) => Context.get(server.context, Notes).events({ ...one, startsAt: "2026-10-12T16:47:58Z" }),
        )
        return { first, again, kept: kept.find((each) => each.id === incident.id), events }
      }),
    ).then(({ first, again, kept, events }) => {
      expect([first.status, again.status]).toEqual([200, 200])
      expect(kept?.link).toBe(url)
      expect(kept?.raised).toEqual({ tool: "PagerDuty", id: "Q1ABC", by: "gil", at: expect.any(String) })
      expect(again.json()).toEqual(first.json())
      expect(posts).toHaveLength(1)
      const { incident } = JSON.parse(posts[0]?.body ?? "{}")
      expect([incident.service.id, incident.urgency, incident.incident_key]).toEqual(["PDEF456", "high", kept?.id])
      expect(incident.body.details).toContain("- PaymentsDown in production (payments), since 2026-10-12T16:47:58Z")
      for (const each of events) {
        const raised = each.filter((event) => event.kind === "incident-raised")
        expect(raised.map((event) => [event.by, event.text, event.link])).toEqual([["gil", "PagerDuty", url]])
      }
    })
  })

  test("is refused to a viewer, for a closed incident, where Estate is read-only, and where no tool is set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withTool, firings, pagerDuty([]))
        const incident = yield* opened(server)
        yield* ask(server, sending("POST", `/api/incidents/${incident.id}/close`, { how: "it passed" }))
        const closed = yield* raise(server, incident.id)
        const asViewer = yield* raise(yield* serverFor(viewer, firings, pagerDuty([])), incident.id)
        const readOnly = yield* raise(yield* serverFor({ ...withTool, readOnly: true }, firings), incident.id)
        const without = yield* serverFor(settings({ anonymous: { name: "gil", role: "operator" } }), firings)
        const untooled = yield* raise(without, (yield* opened(without)).id)
        return [closed, asViewer, readOnly, untooled].map((each) => [
          each.status,
          (each.json() as { message?: string }).message,
        ])
      }),
    ).then((refused) => {
      expect(refused).toEqual([
        [400, '"Payments down" is closed'],
        [403, "incidents are kept by operators"],
        [403, "Estate is read-only here: it keeps no incidents"],
        [404, "Estate has no incident tool"],
      ])
    }))

  test("says why in the tool's words when it refuses, and keeps nothing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withTool, firings, (call) =>
          call.method === "POST"
            ? reply({ error: { message: "Invalid Input Provided", errors: ["Service not found"] } }, 400)
            : reply({ incidents: [] }),
        )
        const incident = yield* opened(server)
        const refused = yield* raise(server, incident.id)
        const kept = (yield* SubscriptionRef.get(Context.get(server.context, Estate))).incidents ?? []
        return { refused, kept: kept.find((each) => each.id === incident.id) }
      }),
    ).then(({ refused, kept }) => {
      expect([refused.status, refused.json()]).toEqual([
        502,
        { message: "PagerDuty answered 400: Invalid Input Provided: Service not found" },
      ])
      expect([kept?.link, kept?.raised]).toEqual([undefined, undefined])
    }))

  test("tells the page which tool an operator may raise in, but not where Estate is read-only", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const me = (configured: typeof withTool) =>
          Effect.flatMap(serverFor(configured), (server) =>
            Effect.map(
              ask(server, new Request("http://estate/api/me")),
              (answered) => (answered.json() as Me).incidentTool,
            ),
          )
        return [yield* me(withTool), yield* me({ ...withTool, readOnly: true })]
      }),
    ).then((tools) => {
      expect(tools).toEqual(["PagerDuty", undefined])
    }))
})
