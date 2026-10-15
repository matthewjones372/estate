import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { ask, environment, estate, serverFor, settings } from "../fixture"
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
const operator = settings({ anonymous: { name: "gil", role: "operator" } })
const viewer = settings({ anonymous: { name: "vi", role: "viewer" } })

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

/** An incident opened on the orders firing by an operator, and what `as` then writes happened, with when. */
const writing = (as: typeof viewer, ...asked: ReadonlyArray<{ readonly text: string; readonly at?: string }>) =>
  Effect.gen(function* () {
    const opening = yield* serverFor(operator, firing)
    const incident = (yield* ask(
      opening,
      sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" }),
    )).json() as Incident
    const server = as === operator ? opening : yield* serverFor(as, { ...firing, incidents: [incident] })
    const answers = yield* Effect.forEach(asked, (body) =>
      ask(server, sending("POST", `/api/incidents/${incident.id}/happened`, body)),
    )
    const record = (yield* ask(server, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
    return { answers: answers.map((each) => [each.status, each.json()]), record }
  })

describe("what happened, as a person writes it", () => {
  test("shows on the timeline at the time they gave, marked written, with when it was kept", () =>
    Effect.runPromise(writing(viewer, { text: " Rolled the registry back by hand ", at: "2026-10-12T16:50:00Z" })).then(
      ({ answers, record }) => {
        expect(answers[0]?.[0]).toBe(201)
        const written = record.events.find((each) => each.kind === "happened")
        expect([written?.at, written?.by, written?.text, written?.source]).toEqual([
          "2026-10-12T16:50:00.000Z",
          "vi",
          "Rolled the registry back by hand",
          "written",
        ])
        expect(Date.parse(written?.recordedAt ?? "")).toBeGreaterThan(Date.parse("2026-10-14T00:00:00Z"))
      },
    ))

  test("is now when no time is given", () =>
    Effect.runPromise(writing(operator, { text: "Postgres failover" })).then(({ record }) => {
      const written = record.events.find((each) => each.kind === "happened")
      expect(written?.at).toBe(written?.recordedAt)
    }))

  test("is refused, saying why, at a time outside the incident's window or with no text", () =>
    Effect.runPromise(
      writing(
        operator,
        { text: "too early", at: "2026-10-12T15:00:00Z" },
        { text: "not yet", at: "2099-01-01T00:00:00Z" },
        { text: "whenever", at: "soon" },
        { text: "  " },
      ),
    ).then(({ answers }) => {
      expect(answers).toEqual([
        [400, { message: "what happened is in the incident's window, from 2026-10-12 16:17:58 UTC to now" }],
        [400, { message: "what happened is in the incident's window, from 2026-10-12 16:17:58 UTC to now" }],
        [400, { message: "when it happened is a time, such as 2026-10-12T14:05:00Z" }],
        [400, { message: "what happened is 1 to 2000 characters" }],
      ])
    }))
})
