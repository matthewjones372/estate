import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Schema } from "effect"
import { liveModel, Model, type Shape } from "./model"
import { type Call, reply, stubRemote } from "./remote"
import type { Ai } from "./settings"

const claude: Ai = { provider: "anthropic", apiKey: Redacted.make("key"), model: "claude-haiku-5-5" }
const Headline = Schema.Struct({ headline: Schema.String })
const headline: Shape<typeof Headline.Type, typeof Headline.Encoded> = {
  system: "Write a headline as JSON.",
  answer: Headline,
  tidy: (answer) => ({ headline: answer.headline.trim() }),
}

describe("the model, asked for a shape of the caller's", () => {
  test("is told the caller's instructions, held to its schema, and answers decoded and tidied in it", () => {
    const calls: Call[] = []
    const answered = (call: Call) => {
      calls.push(call)
      return reply({
        content: [{ type: "text", text: '{"headline": " Orders slow after a deploy "}' }],
        usage: { input_tokens: 100, output_tokens: 20 },
      })
    }
    return Effect.runPromise(
      Effect.flatMap(Model, (model) => model.answer(headline, "the brief", "what happened?")).pipe(
        Effect.provide(liveModel(claude).pipe(Layer.provide(stubRemote(answered)))),
      ),
    ).then((asked) => {
      expect(asked.answer).toEqual({ headline: "Orders slow after a deploy" })
      expect(asked.tokens).toBe(120)
      const body = JSON.parse(calls[0]?.body ?? "{}")
      expect(body.system[0].text).toBe("Write a headline as JSON.")
      expect(Object.keys(body.output_config.format.schema.properties)).toEqual(["headline"])
      expect(body.output_config.format.schema.additionalProperties).toBe(false)
    })
  })
})
