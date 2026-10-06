import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"

const withAi = (tokensPerDay?: number): Settings => ({
  ...settings({ anonymous: { name: "gil", role: "operator" } }),
  ai: {
    provider: "openai-compatible",
    url: "http://model.test/v1",
    model: "fake-model",
    apiKey: Redacted.make("sk-test"),
    ...(tokensPerDay === undefined ? {} : { budget: { tokensPerDay } }),
  },
})

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const withAlert = estate({
  catalog,
  environments: {
    production: environment({
      alerts: ok([
        {
          id: "a1",
          name: "OrdersSlow",
          state: "firing",
          severity: "warning",
          startsAt: "2026-10-03T11:46:00Z",
          labels: { service: "storefront" },
        },
        {
          id: "a2",
          name: "Other",
          state: "firing",
          severity: "warning",
          startsAt: "2026-10-03T11:46:00Z",
          labels: { service: "orders" },
        },
      ]),
      deploys: ok({ storefront: { version: "v2", ready: true, at: "2026-10-03T11:20:00Z" } }),
    }),
  },
})

const modelReply = (call: Call): Reply | undefined => {
  if (!call.url.includes("/chat/completions")) return undefined
  const answer = {
    likelyCause: "A recent deploy raised latency.",
    evidence: [{ text: "storefront v2 deployed before it fired" }],
    nextSteps: ["Check the runbook"],
    confidence: "medium",
  }
  return reply({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { total_tokens: 400 } })
}

const asked = (alert: string) => new Request(`http://estate/api/alerts/${alert}/ask?env=production`, { method: "POST" })

describe("POST /api/alerts/:id/ask", () => {
  test("answers with the model's reading of the brief, the model's name and what it read", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(), withAlert, (call) => {
          calls.push(call)
          return modelReply(call)
        })
        return yield* ask(server, asked("a1"))
      }),
    ).then((answer) => {
      expect([answer.status, answer.json()]).toEqual([
        200,
        {
          likelyCause: "A recent deploy raised latency.",
          evidence: [{ text: "storefront v2 deployed before it fired" }],
          nextSteps: ["Check the runbook"],
          confidence: "medium",
          model: "fake-model",
          read: ["Changed", "Depends"],
        },
      ])
      expect(calls.find((call) => call.url.endsWith("/chat/completions"))?.body).toContain(
        "storefront: v2 deployed, 26 min before it fired",
      )
    })
  })

  test("is not found without ai or without the alert, and says why the model failed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bare = yield* serverFor(settings({ anonymous: { name: "gil", role: "operator" } }), withAlert)
        const broken = yield* serverFor(withAi(), withAlert, (call) =>
          call.url.includes("/chat/completions") ? reply("down", 500) : undefined,
        )
        return [
          yield* ask(bare, asked("a1")),
          yield* ask(broken, asked("nope")),
          yield* ask(broken, asked("a2")),
          // A failed ask gives its turn back, so it can be asked again at once.
          yield* ask(broken, asked("a2")),
        ].map((answer) => [answer.status, answer.json()])
      }),
    ).then((answers) =>
      expect(answers).toEqual([
        [404, { message: "Ask AI is not configured" }],
        [404, { message: "there is no alert nope in production" }],
        [502, { message: "the model answered 500" }],
        [502, { message: "the model answered 500" }],
      ]),
    ))

  test("answers an alert once a minute, and nothing once the day's tokens are spent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(500), withAlert, modelReply)
        return [
          yield* ask(server, asked("a1")),
          yield* ask(server, asked("a1")),
          yield* ask(server, asked("a2")),
          yield* ask(server, asked("a1")),
        ].map((answer) => [answer.status, (answer.json() as { message?: string }).message])
      }),
    ).then((answers) =>
      expect(answers).toEqual([
        [200, undefined],
        [429, "this alert was asked about less than a minute ago"],
        [200, undefined],
        [429, "Ask AI has used today's 500 tokens"],
      ]),
    ))
})
