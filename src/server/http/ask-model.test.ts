import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { type Call, type Reply, stubRemote } from "../remote"
import type { Ai } from "../settings"
import { liveModel, Model } from "./ask"

const jsonAnswer = JSON.stringify({
  likelyCause: "A recent deploy raised latency.",
  evidence: [{ text: "storefront v2 deployed 26 min before it fired" }],
  nextSteps: ["rollback if p99 rose after a deploy"],
  confidence: "medium",
  tools: ["changed", "runbook"],
})

describe("Ask AI's model port", () => {
  test("returns a structured answer from a fake that reads the brief", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const model = yield* Model
        return yield* model.ask(
          "storefront v2 deployed 26 min before it fired.\nRunbook: rollback if p99 rose after a deploy.",
          "What caused OrdersSlow?",
        )
      }).pipe(
        Effect.provide(
          Layer.succeed(Model, {
            ask: (brief) =>
              Effect.succeed({
                likelyCause: brief.includes("deployed")
                  ? "A recent deploy raised latency."
                  : "Not enough evidence in the brief.",
                evidence: [{ text: "storefront v2 deployed 26 min before it fired" }],
                nextSteps: ["rollback if p99 rose after a deploy"],
                confidence: "medium" as const,
                tools: ["changed", "runbook"],
                model: "fake-model",
              }),
          }),
        ),
      ),
    ).then((answer) => {
      expect(answer.likelyCause).toContain("deploy")
      expect(answer.evidence[0]?.text).toContain("deployed")
      expect(answer.nextSteps[0]).toContain("rollback")
      expect(answer.confidence).toBe("medium")
      expect(answer.tools).toContain("changed")
    }))

  test("asks an OpenAI-compatible server through Remote", () => {
    const ai: Ai = {
      provider: "openai-compatible",
      url: "http://vllm.test/v1",
      model: "local-model",
      apiKey: Redacted.make("sk"),
    }
    const answer = (call: Call): Reply | undefined => {
      if (!call.url.endsWith("/chat/completions")) return undefined
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ choices: [{ message: { content: jsonAnswer } }] }),
      }
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const model = yield* Model
        return yield* model.ask("brief with a deploy", "why?")
      }).pipe(Effect.provide(liveModel(ai).pipe(Layer.provide(stubRemote(answer))))),
    ).then((result) => {
      expect(result.model).toBe("local-model")
      expect(result.likelyCause).toContain("deploy")
    })
  })

  test("asks Anthropic through Remote", () => {
    const ai: Ai = { provider: "anthropic", model: "claude-test", apiKey: Redacted.make("sk") }
    const answer = (call: Call): Reply | undefined => {
      if (!call.url.includes("anthropic.com")) return undefined
      return {
        status: 200,
        headers: {},
        text: JSON.stringify({ content: [{ type: "text", text: jsonAnswer }] }),
      }
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const model = yield* Model
        return yield* model.ask("brief", "why?")
      }).pipe(Effect.provide(liveModel(ai).pipe(Layer.provide(stubRemote(answer))))),
    ).then((result) => {
      expect(result.model).toBe("claude-test")
      expect(result.likelyCause).toContain("deploy")
    })
  })

  test("fails when ai is not configured", () =>
    Effect.runPromise(
      Effect.result(
        Effect.gen(function* () {
          const model = yield* Model
          return yield* model.ask("brief", "why?")
        }).pipe(Effect.provide(liveModel(undefined).pipe(Layer.provide(stubRemote(() => undefined))))),
      ),
    ).then((result) => {
      expect(result._tag).toBe("Failure")
    }))
})

test("fails when Anthropic has no apiKey", () => {
  const ai: Ai = { provider: "anthropic", model: "claude-test" }
  return Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const model = yield* Model
        return yield* model.ask("brief", "why?")
      }).pipe(Effect.provide(liveModel(ai).pipe(Layer.provide(stubRemote(() => undefined))))),
    ),
  ).then((result) => expect(result._tag).toBe("Failure"))
})

test("asks provider openai the same way as openai-compatible", () => {
  const ai: Ai = { provider: "openai", model: "gpt-test", apiKey: Redacted.make("sk") }
  const answer = (call: Call): Reply | undefined => {
    if (!call.url.includes("api.openai.com")) return undefined
    return {
      status: 200,
      headers: {},
      text: JSON.stringify({ choices: [{ message: { content: jsonAnswer } }] }),
    }
  }
  return Effect.runPromise(
    Effect.gen(function* () {
      const model = yield* Model
      return yield* model.ask("brief", "why?")
    }).pipe(Effect.provide(liveModel(ai).pipe(Layer.provide(stubRemote(answer))))),
  ).then((result) => expect(result.model).toBe("gpt-test"))
})

test("fails when the model returns non-JSON", () => {
  const ai: Ai = { provider: "openai-compatible", url: "http://vllm.test/v1", model: "x" }
  const answer = (): Reply => ({
    status: 200,
    headers: {},
    text: JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
  })
  return Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const model = yield* Model
        return yield* model.ask("brief", "why?")
      }).pipe(Effect.provide(liveModel(ai).pipe(Layer.provide(stubRemote(answer))))),
    ),
  ).then((result) => expect(result._tag).toBe("Failure"))
})

test("fails when the model HTTP status is not ok", () => {
  const ai: Ai = { provider: "openai-compatible", url: "http://vllm.test/v1", model: "x" }
  const answer = (): Reply => ({ status: 500, headers: {}, text: "nope" })
  return Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const model = yield* Model
        return yield* model.ask("brief", "why?")
      }).pipe(Effect.provide(liveModel(ai).pipe(Layer.provide(stubRemote(answer))))),
    ),
  ).then((result) => expect(result._tag).toBe("Failure"))
})

test("treats Anthropic empty content as an empty answer to parse", () => {
  const ai: Ai = { provider: "anthropic", model: "claude-test", apiKey: Redacted.make("sk") }
  const answer = (): Reply => ({
    status: 200,
    headers: {},
    text: JSON.stringify({ content: [{ type: "thinking" }] }),
  })
  return Effect.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const model = yield* Model
        return yield* model.ask("brief", "why?")
      }).pipe(Effect.provide(liveModel(ai).pipe(Layer.provide(stubRemote(answer))))),
    ),
  ).then((result) => expect(result._tag).toBe("Failure"))
})
