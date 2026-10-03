import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, environment, estate, serverFor, settings } from "../fixture"
import type { Call } from "../remote"

const readOnly = {
  ...settings({ anonymous: { name: "gil", role: "operator" } }),
  readOnly: true,
  sources: {
    staging: {
      alertmanager: { url: "http://alertmanager/" },
      kubernetes: { url: "https://cluster", token: Redacted.make("t") },
    },
    production: {},
  },
}

const firing = estate({
  environments: {
    staging: environment({
      alerts: {
        state: "ok",
        value: [
          {
            id: "a1",
            name: "OrdersSlow",
            state: "firing",
            severity: "warning",
            startsAt: "t",
            labels: { app: "orders" },
          },
        ],
      },
    }),
    production: environment(),
  },
})

const send = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe("a read-only estate", () => {
  test("refuses every write to another tool, even an operator's, and sends no call that writes", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(readOnly, firing, (call) => {
          calls.push(call)
          return undefined
        })
        const answers = yield* Effect.forEach(
          [
            send("POST", "/api/silences", { environment: "staging", alert: "a1", minutes: 60, reason: "vacuum" }),
            send("DELETE", "/api/silences/s1?env=staging"),
            send("POST", "/api/debug", { environment: "staging", service: "storefront", minutes: 15 }),
            send("DELETE", "/api/debug/storefront?env=staging"),
          ],
          (request) => ask(server, request),
        )
        return answers.map((answered) => [answered.status, answered.json()])
      }),
    ).then((answers) => {
      expect(answers).toEqual([
        [403, { message: "Estate is read-only here: it silences nothing" }],
        [403, { message: "Estate is read-only here: it silences nothing" }],
        [403, { message: "Estate is read-only here: it switches no debug" }],
        [403, { message: "Estate is read-only here: it switches no debug" }],
      ])
      expect(calls.filter((call) => (call.method ?? "GET") !== "GET")).toEqual([])
    })
  })

  test("tells the page, which shows neither silences nor debug", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(readOnly, firing)
        return (yield* ask(server, new Request("http://estate/api/me"))).json()
      }),
    ).then((me) => {
      expect(me).toMatchObject({ name: "gil", role: "operator", readOnly: true })
    }))
})
