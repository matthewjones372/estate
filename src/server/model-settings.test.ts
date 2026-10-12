import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { liveModel, Model, type Tools } from "./model"
import { type Call, type Reply, reply, stubRemote } from "./remote"
import type { Ai } from "./settings"

const answer = {
  likelyCause: "A recent deploy raised latency.",
  evidence: [
    { text: "storefront v2 deployed 26 min before it fired", href: "https://ci.example/1" },
    { text: "a link the page must not follow", href: "javascript:alert(1)" },
  ],
  nextSteps: ["roll back if p99 rose after a deploy"],
  confidence: "medium",
}
const chat = (content: string | null, usage = { total_tokens: 900 }) =>
  reply({ choices: [{ message: { content } }], usage })

const asking = (ai: Ai | undefined, answer: (call: Call) => Reply | undefined, calls: Call[] = []) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(Model, (model) => model.ask("the brief", "why?")).pipe(
        Effect.provide(
          liveModel(ai).pipe(
            Layer.provide(
              stubRemote((call) => {
                calls.push(call)
                return answer(call)
              }),
            ),
          ),
        ),
      ),
    ),
  )

describe("what the settings let an ask spend", () => {
  test("sends effort to the chat providers that reason, only when the settings ask", () => {
    const calls: Call[] = []
    const answering = () => chat(JSON.stringify(answer))
    return Promise.all([
      asking({ provider: "openai", model: "o", apiKey: Redacted.make("ok"), effort: "medium" }, answering, calls),
      asking({ provider: "openai", model: "o", apiKey: Redacted.make("ok") }, answering, calls),
      asking(
        { provider: "openai-compatible", url: "http://vllm.test/v1", model: "local", effort: "high" },
        answering,
        calls,
      ),
    ]).then(() =>
      expect(calls.map((call) => JSON.parse(call.body ?? "{}").reasoning_effort)).toEqual([
        "medium",
        undefined,
        undefined,
      ]),
    )
  })

  test("takes as many rounds of tools as the settings give, and reads a long tool result cut short", () => {
    const sent: string[] = []
    const tools: Tools = {
      offers: [{ name: "changes", description: "what changed", schema: { type: "object" } }],
      run: () => Effect.succeed("x".repeat(50)),
    }
    let offered = 0
    const insistent = (call: Call) => {
      const body = JSON.parse(call.body ?? "{}")
      for (const message of body.messages) if (message.role === "tool") sent.push(message.content)
      if (body.tools === undefined) return chat(JSON.stringify(answer))
      offered += 1
      return reply({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: `c${offered}`, function: { name: "changes", arguments: "{}" } }],
            },
          },
        ],
      })
    }
    const local: Ai = {
      provider: "openai-compatible",
      url: "http://vllm.test/v1",
      model: "local",
      toolRounds: 3,
      toolResultChars: 20,
    }
    return Effect.runPromise(
      Effect.flatMap(Model, (model) => model.ask("the brief", "why?", tools)).pipe(
        Effect.provide(liveModel(local).pipe(Layer.provide(stubRemote(insistent)))),
      ),
    ).then(() => {
      expect(offered).toBe(3)
      expect(sent[0]).toBe(`${"x".repeat(20)}\n… cut here: 30 more characters`)
    })
  })
})
