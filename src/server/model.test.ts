import { describe, expect, test } from "bun:test"
import { Duration, Effect, Layer, Redacted, Result } from "effect"
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
const anthropic = (text: string) =>
  reply({ content: [{ type: "text", text }], usage: { input_tokens: 700, output_tokens: 200 } })

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

const succeeded = <A, E>(result: Result.Result<A, E> | undefined) =>
  result !== undefined && Result.isSuccess(result) ? result.success : undefined
const failed = <A, E extends { message: string }>(result: Result.Result<A, E>) =>
  Result.isFailure(result) ? result.failure.message : undefined

describe("the model Ask AI asks", () => {
  test("is asked through each provider's API with its key, given a minute, and its tokens are counted", () => {
    const calls: Call[] = []
    const providers: ReadonlyArray<readonly [Ai, string, (call: Call) => Reply]> = [
      [
        { provider: "anthropic", model: "claude-opus-5-5", apiKey: Redacted.make("ak") },
        "https://api.anthropic.com/v1/messages",
        () => anthropic(`Here it is:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``),
      ],
      [
        { provider: "openai", model: "gpt", apiKey: Redacted.make("ok") },
        "https://api.openai.com/v1/chat/completions",
        () => chat(JSON.stringify(answer)),
      ],
      [
        { provider: "openai-compatible", url: "http://vllm.test/v1/", model: "local" },
        "http://vllm.test/v1/chat/completions",
        () => chat(JSON.stringify(answer)),
      ],
      [
        { provider: "xai", model: "grok", apiKey: Redacted.make("xk") },
        "https://api.x.ai/v1/chat/completions",
        () => chat(JSON.stringify(answer)),
      ],
      [
        { provider: "gemini", model: "gemini", apiKey: Redacted.make("gk") },
        "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
        () => chat(JSON.stringify(answer)),
      ],
    ]
    return Promise.all(providers.map(([ai, , answering]) => asking(ai, answering, calls))).then((results) => {
      expect(calls.map((call) => call.url)).toEqual(providers.map(([, url]) => url))
      expect(calls.map((call) => call.headers?.["x-api-key"] ?? call.headers?.["authorization"])).toEqual([
        "ak",
        "Bearer ok",
        undefined,
        "Bearer xk",
        "Bearer gk",
      ])
      expect(calls.every((call) => call.timeout !== undefined && Duration.toSeconds(call.timeout) === 60)).toBe(true)
      const first = succeeded(results[0])
      expect(first).toEqual({
        answer: {
          ...answer,
          confidence: "medium",
          evidence: [
            { text: "storefront v2 deployed 26 min before it fired", href: "https://ci.example/1" },
            { text: "a link the page must not follow" },
          ],
        },
        model: "claude-opus-5-5",
        called: [],
        tokens: 900,
      })
      expect(results.map((result) => succeeded(result)?.tokens)).toEqual([900, 900, 900, 900, 900])
    })
  })

  test("fails saying why, never crashing, when the reply is not what was asked for", () => {
    const local: Ai = { provider: "openai-compatible", url: "http://vllm.test/v1", model: "local" }
    const claude: Ai = { provider: "anthropic", model: "claude-opus-5-5", apiKey: Redacted.make("ak") }
    return Promise.all([
      asking(undefined, () => undefined),
      asking(local, () => reply("down", 500)),
      asking(claude, () => reply({ content: null })),
      asking(local, () => reply("not json")),
      asking(local, () => chat(null)),
      asking(local, () => chat(JSON.stringify({ ...answer, confidence: "certain" }))),
      asking(claude, () => anthropic("I could not decide.")),
    ]).then((results) =>
      expect(results.map(failed)).toEqual([
        "Ask AI is not configured",
        "the model answered 500",
        "Anthropic's reply was not in its API's shape",
        "the model's reply was not in its API's shape",
        "the model did not answer in the shape it was asked for",
        "the model did not answer in the shape it was asked for",
        "the model did not answer in the shape it was asked for",
      ]),
    )
  })

  test("may call Estate's read tools before answering, through either API, and lists what it called", () => {
    const asked: Array<ReadonlyArray<string>> = []
    const tools: Tools = {
      offers: [
        { name: "service", description: "one service", schema: { type: "object" } },
        { name: "changes", description: "what changed", schema: { type: "object" } },
      ],
      run: (call) => {
        asked.push([call.name, JSON.stringify(call.input)])
        return Effect.succeed(call.name === "service" ? '{"health":"attention"}' : '{"items":[]}')
      },
    }
    // Each fake asks for both tools first, then answers once it has read their results.
    const anthropicFake = (call: Call) => {
      const body = JSON.parse(call.body ?? "{}")
      const answered = JSON.stringify(body.messages).includes("tool_result")
      return answered
        ? anthropic(JSON.stringify(answer))
        : reply({
            content: [
              { type: "tool_use", id: "t1", name: "service", input: { name: "orders" } },
              { type: "tool_use", id: "t2", name: "changes", input: {} },
            ],
            usage: { input_tokens: 100, output_tokens: 20 },
          })
    }
    const chatFake = (call: Call) => {
      const body = JSON.parse(call.body ?? "{}")
      const answered = body.messages.some((message: { role: string }) => message.role === "tool")
      return answered
        ? chat(JSON.stringify(answer))
        : reply({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: "c1", function: { name: "service", arguments: '{"name":"orders"}' } },
                    { id: "c2", function: { name: "changes", arguments: "{}" } },
                  ],
                },
              },
            ],
            usage: { total_tokens: 120 },
          })
    }
    const claude: Ai = { provider: "anthropic", model: "claude-opus-5-5", apiKey: Redacted.make("ak") }
    const local: Ai = { provider: "openai-compatible", url: "http://vllm.test/v1", model: "local" }
    const asking = (ai: Ai, answering: (call: Call) => Reply) =>
      Effect.runPromise(
        Effect.flatMap(Model, (model) => model.ask("the brief", "why?", tools)).pipe(
          Effect.provide(liveModel(ai).pipe(Layer.provide(stubRemote(answering)))),
        ),
      )
    return Promise.all([asking(claude, anthropicFake), asking(local, chatFake)]).then(([fromClaude, fromLocal]) => {
      expect(fromClaude.called).toEqual(["service orders", "changes"])
      expect(fromLocal.called).toEqual(["service orders", "changes"])
      expect(fromClaude.tokens).toBe(1020)
      expect(fromLocal.tokens).toBe(1020)
      expect(asked).toEqual([
        ["service", '{"name":"orders"}'],
        ["changes", "{}"],
        ["service", '{"name":"orders"}'],
        ["changes", "{}"],
      ])
    })
  })

  test("is told to answer with what it has once its rounds of tools are spent", () => {
    let offered = 0
    const tools: Tools = {
      offers: [{ name: "changes", description: "what changed", schema: { type: "object" } }],
      run: () => Effect.succeed("{}"),
    }
    const insistent = (call: Call) => {
      const body = JSON.parse(call.body ?? "{}")
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
    const local: Ai = { provider: "openai-compatible", url: "http://vllm.test/v1", model: "local" }
    return Effect.runPromise(
      Effect.flatMap(Model, (model) => model.ask("the brief", "why?", tools)).pipe(
        Effect.provide(liveModel(local).pipe(Layer.provide(stubRemote(insistent)))),
      ),
    ).then((asked) => {
      expect(offered).toBe(4)
      expect(asked.called).toEqual(["changes", "changes", "changes", "changes"])
    })
  })
})
