import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import type { Call, Reply } from "../remote"
import type { Settings } from "../settings"
import { resetAskLimits } from "./ask"

const withAi = (): Settings => ({
  ...settings({ anonymous: { name: "gil", role: "operator" } }),
  ai: {
    provider: "openai-compatible",
    url: "http://model.test/v1",
    model: "fake-model",
    apiKey: Redacted.make("sk-test"),
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
    evidence: [{ text: "storefront v2 deployed before it fired" }, "skip", { no: "text" }],
    nextSteps: ["Check the runbook", 3],
    confidence: "medium",
    tools: ["changed", null],
  }
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    text: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }),
  }
}

const brokenReply = (call: Call): Reply | undefined => {
  if (!call.url.includes("/chat/completions")) return undefined
  return { status: 500, headers: {}, text: "down" }
}

describe("POST /api/alerts/:id/ask", () => {
  test("streams an answer when ai is configured and the model calls tools", () => {
    resetAskLimits()
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(), withAlert, modelReply)
        return yield* ask(server, new Request("http://estate/api/alerts/a1/ask?env=production", { method: "POST" }))
      }),
    ).then((answer) => {
      expect(answer.status).toBe(200)
      expect(answer.headers.get("content-type")).toContain("text/event-stream")
      expect(answer.text).toContain("event: answer")
      expect(answer.text).toContain("A recent deploy raised latency.")
      expect(answer.text).toContain("event: chunk")
    })
  })

  test("is 404 when Ask AI is not configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(settings({ anonymous: { name: "gil", role: "operator" } }), withAlert)
        return yield* ask(server, new Request("http://estate/api/alerts/a1/ask?env=production", { method: "POST" }))
      }),
    ).then((answer) => {
      expect(answer.status).toBe(404)
      expect((answer.json() as { message: string }).message).toContain("not configured")
    }))

  test("is 404 for a missing alert", () => {
    resetAskLimits()
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(), withAlert, modelReply)
        return yield* ask(server, new Request("http://estate/api/alerts/nope/ask?env=production", { method: "POST" }))
      }),
    ).then((answer) => expect(answer.status).toBe(404))
  })

  test("streams an error when the model fails", () => {
    resetAskLimits()
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(), withAlert, brokenReply)
        return yield* ask(server, new Request("http://estate/api/alerts/a2/ask?env=production", { method: "POST" }))
      }),
    ).then((answer) => {
      expect(answer.status).toBe(200)
      expect(answer.text).toContain("event: error")
    })
  })

  test("rate-limits a second ask for the same alert within a minute", () => {
    resetAskLimits()
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(), withAlert, modelReply)
        const first = yield* ask(
          server,
          new Request("http://estate/api/alerts/a1/ask?env=production", { method: "POST" }),
        )
        const second = yield* ask(
          server,
          new Request("http://estate/api/alerts/a1/ask?env=production", { method: "POST" }),
        )
        return [first.status, second.status, (second.json() as { message: string }).message] as const
      }),
    ).then(([first, second, message]) => {
      expect(first).toBe(200)
      expect(second).toBe(429)
      expect(message).toContain("rate-limited")
    })
  })
})
