import { describe, expect, test } from "bun:test"
import { Effect, SubscriptionRef } from "effect"
import { ask, environment, estate, type Server, serverFor, settings } from "../fixture"
import { type Call, reply } from "../remote"
import { Estate, type SourcedAlert } from "../state"

const alert: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-03T11:46:00Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}
const silenced: SourcedAlert = {
  ...alert,
  id: "a2",
  state: "silenced",
  silence: { id: "s9", by: "ada", reason: "resizing", startsAt: "t", endsAt: "t" },
}
const firing = estate({
  environments: {
    staging: environment({ alerts: { state: "ok", value: [alert, silenced] } }),
    production: environment(),
  },
})

const configured = (role: "viewer" | "operator") => ({
  ...settings({ anonymous: { name: "gil", role } }),
  sources: { staging: { alertmanager: { url: "http://alertmanager/" } }, production: {} },
})

const manager =
  (calls: Call[], status = 200) =>
  (call: Call) => {
    calls.push(call)
    if (call.url === "http://alertmanager/api/v2/silences" && call.method === "POST")
      return reply(status === 200 ? { silenceID: "s1" } : "broken", status)
    if (call.url === "http://alertmanager/api/v2/silence/s9" && call.method === "DELETE") return reply("", status)
    return undefined
  }

const post = (body: unknown) =>
  new Request("http://estate/api/silences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
const alertsOf = (server: Server) =>
  Effect.gen(function* () {
    const { environments } = yield* SubscriptionRef.get(yield* Effect.provide(Estate, server.context))
    const { staging } = environments
    return staging?.alerts.value ?? []
  })

describe("silencing an alert", () => {
  test("writes a silence to Alertmanager for its labels, with who and why, and shows it at once", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured("operator"), firing, manager(calls))
        const answered = yield* ask(
          server,
          post({ environment: "staging", alert: "a1", minutes: 60, reason: " vacuum " }),
        )
        expect(answered.status).toBe(201)
        const sent = JSON.parse(calls[0]?.body ?? "{}")
        expect(sent).toMatchObject({
          createdBy: "gil",
          comment: "vacuum",
          matchers: [
            { name: "alertname", value: "OrdersSlow", isRegex: false, isEqual: true },
            { name: "app", value: "orders" },
          ],
        })
        expect(Date.parse(sent.endsAt) - Date.parse(sent.startsAt)).toBe(3_600_000)
        const [first] = yield* alertsOf(server)
        expect(first).toMatchObject({ state: "silenced", silence: { id: "s1", by: "gil", reason: "vacuum" } })
      }),
    )
  })

  test("is for operators, with a reason, for a minute to a week, of an alert that is here", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const viewer = yield* serverFor(configured("viewer"), firing, manager([]))
        expect(
          (yield* ask(viewer, post({ environment: "staging", alert: "a1", minutes: 60, reason: "x" }))).status,
        ).toBe(403)
        const server = yield* serverFor(configured("operator"), firing, manager([]))
        const refusal = (body: unknown) =>
          ask(server, post(body)).pipe(Effect.map((answered) => [answered.status, answered.json()]))
        expect(yield* refusal({ environment: "staging", alert: "a1", minutes: 60, reason: " " })).toEqual([
          400,
          { message: "a silence needs a reason, shown to everyone" },
        ])
        expect(yield* refusal({ environment: "staging", alert: "a1", minutes: 99999, reason: "x" })).toEqual([
          400,
          { message: "a silence lasts a minute to a week" },
        ])
        expect(yield* refusal({ environment: "staging", alert: "zz", minutes: 60, reason: "x" })).toEqual([
          404,
          { message: "that alert is not firing here" },
        ])
        expect(yield* refusal({ environment: "production", alert: "a1", minutes: 60, reason: "x" })).toEqual([
          404,
          { message: "production has no Alertmanager, Grafana or Datadog to silence with" },
        ])
        expect(yield* refusal({ environment: "qa", alert: "a1", minutes: 60, reason: "x" })).toEqual([
          404,
          { message: "qa is not an environment" },
        ])
        expect(yield* refusal({ alert: "a1" })).toEqual([
          400,
          { message: "a silence is an environment, an alert, minutes and a reason" },
        ])
      }),
    ))

  test("says what Alertmanager said when it refuses", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured("operator"), firing, manager([], 500))
        const answered = yield* ask(server, post({ environment: "staging", alert: "a1", minutes: 60, reason: "x" }))
        expect([answered.status, answered.json()]).toEqual([502, { message: "Alertmanager answered 500: broken" }])
        const lifted = yield* ask(
          server,
          new Request("http://estate/api/silences/s9?env=staging", { method: "DELETE" }),
        )
        expect(lifted.status).toBe(502)
      }),
    ))
})

describe("lifting a silence", () => {
  test("expires it in Alertmanager, and the alert fires again on the page", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured("operator"), firing, manager(calls))
        const answered = yield* ask(
          server,
          new Request("http://estate/api/silences/s9?env=staging", { method: "DELETE" }),
        )
        expect(answered.status).toBe(200)
        expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
          "DELETE http://alertmanager/api/v2/silence/s9",
        ])
        const alerts = yield* alertsOf(server)
        expect(alerts.map((each) => [each.id, each.state, each.silence?.id])).toEqual([
          ["a1", "firing", undefined],
          ["a2", "firing", undefined],
        ])
      }),
    )
  })

  test("is for operators", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const viewer = yield* serverFor(configured("viewer"), firing, manager([]))
        expect(
          (yield* ask(viewer, new Request("http://estate/api/silences/s9?env=staging", { method: "DELETE" }))).status,
        ).toBe(403)
      }),
    ))
})
