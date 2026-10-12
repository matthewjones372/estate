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

describe("Anthropic, as Ask AI asks it", () => {
  test("sends back a reply's blocks whole, so a model that thinks before calling a tool can go on", () => {
    const thought = { type: "thinking", thinking: "Check the service first.", signature: "sig-1" }
    const sent: unknown[] = []
    const tools: Tools = {
      offers: [{ name: "service", description: "one service", schema: { type: "object" } }],
      run: () => Effect.succeed('{"health":"attention"}'),
    }
    const thinking = (call: Call) => {
      const body = JSON.parse(call.body ?? "{}")
      sent.push(...body.messages)
      return body.messages.length > 1
        ? anthropic(JSON.stringify(answer))
        : reply({
            content: [thought, { type: "tool_use", id: "t1", name: "service", input: { name: "orders" } }],
            usage: { input_tokens: 100, output_tokens: 20 },
          })
    }
    const claude: Ai = { provider: "anthropic", model: "claude-opus-5-5", apiKey: Redacted.make("ak") }
    return Effect.runPromise(
      Effect.flatMap(Model, (model) => model.ask("the brief", "why?", tools)).pipe(
        Effect.provide(liveModel(claude).pipe(Layer.provide(stubRemote(thinking)))),
      ),
    ).then((asked) => {
      expect(asked.called).toEqual(["service orders"])
      expect(sent).toContainEqual({
        role: "assistant",
        content: [thought, { type: "tool_use", id: "t1", name: "service", input: { name: "orders" } }],
      })
    })
  })

  test("asks Anthropic for its answer in the answer's shape, with room to think first", () => {
    const calls: Call[] = []
    const claude: Ai = { provider: "anthropic", model: "claude-opus-5-5", apiKey: Redacted.make("ak") }
    return asking(claude, () => anthropic(JSON.stringify(answer)), calls).then(() => {
      const body = JSON.parse(calls[0]?.body ?? "{}")
      expect(body.max_tokens).toBe(8192)
      expect(body.output_config.format.type).toBe("json_schema")
      expect(body.output_config.format.schema.required).toEqual(["likelyCause", "evidence", "nextSteps", "confidence"])
      expect(body.output_config.format.schema.additionalProperties).toBe(false)
      expect(body.output_config.format.schema.properties.evidence.items.additionalProperties).toBe(false)
    })
  })

  test("marks what repeats for Anthropic's cache, keeps its tools on the last round, and splits the tokens", () => {
    const bodies: Array<{
      system: ReadonlyArray<{ cache_control?: unknown }>
      messages: ReadonlyArray<{ content: ReadonlyArray<{ cache_control?: unknown }> }>
      tools?: unknown
      tool_choice?: unknown
    }> = []
    const tools: Tools = {
      offers: [{ name: "service", description: "one service", schema: { type: "object" } }],
      run: () => Effect.succeed("{}"),
    }
    const insistent = (call: Call) => {
      bodies.push(JSON.parse(call.body ?? "{}"))
      const usage = {
        input_tokens: 100,
        cache_read_input_tokens: 900,
        cache_creation_input_tokens: 50,
        output_tokens: 20,
      }
      return bodies.at(-1)?.tool_choice === undefined
        ? reply({ content: [{ type: "tool_use", id: `t${bodies.length}`, name: "service", input: {} }], usage })
        : reply({ content: [{ type: "text", text: JSON.stringify(answer) }], usage })
    }
    const claude: Ai = { provider: "anthropic", model: "claude-opus-5-5", apiKey: Redacted.make("ak") }
    const marked = (blocks: ReadonlyArray<{ cache_control?: unknown }> | undefined) =>
      blocks?.map((block) => block.cache_control !== undefined)
    return Effect.runPromise(
      Effect.flatMap(Model, (model) => model.ask("the brief", "why?", tools)).pipe(
        Effect.provide(liveModel(claude).pipe(Layer.provide(stubRemote(insistent)))),
      ),
    ).then((asked) => {
      expect(bodies).toHaveLength(5)
      expect(bodies.map((body) => marked(body.system))).toEqual(Array(5).fill([true]))
      // The brief, and the newest message: each round reads all before it from the cache.
      expect(bodies.map((body) => body.messages.map((message) => marked(message.content)?.at(-1)))).toEqual([
        [true],
        [true, false, true],
        [true, false, false, false, true],
        [true, false, false, false, false, false, true],
        [true, false, false, false, false, false, false, false, true],
      ])
      expect(bodies.every((body) => body.tools !== undefined)).toBe(true)
      expect(bodies.map((body) => body.tool_choice)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined,
        { type: "none" },
      ])
      expect(asked.usage).toEqual({ input: 750, cached: 4500, output: 100 })
      expect(asked.tokens).toBe(5350)
    })
  })
})
