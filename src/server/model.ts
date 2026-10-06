/**
 * The model Ask AI asks, behind one port: Anthropic's Messages API, or the Chat Completions API that OpenAI, xAI,
 * Gemini and self-hosted servers (vLLM, Ollama, LiteLLM) speak. Every call goes through `Remote`, and every reply is
 * decoded, so a provider answering in an unexpected shape is a `ModelError`, never a crash.
 */
import { Context, Data, Duration, Effect, Layer, Redacted, Schema } from "effect"
import { ModelAnswer } from "../shared/ask"
import { type Call, Remote } from "./remote"
import type { Ai } from "./settings"

const ModelError = Data.TaggedError("ModelError")<{ readonly message: string }>
type ModelError = InstanceType<typeof ModelError>

/** What a model answered, and how many tokens the call took, for the day's budget. */
interface Asked {
  readonly answer: ModelAnswer
  readonly model: string
  readonly tokens: number
}

export interface Model {
  readonly ask: (brief: string, question: string) => Effect.Effect<Asked, ModelError>
}
export const Model = Context.Service<Model>("estate/Model")

/** A model reads before it answers, so it is given longer than a tool's API. */
const thinking = Duration.seconds(60)
const longest = 1024

const system = `You are Estate's incident investigator. Answer only from the brief you are given; if it does not
show the cause, say so with low confidence. Reply with one JSON object and nothing else:
{"likelyCause": string, "evidence": [{"text": string, "href"?: string}], "nextSteps": [string],
 "confidence": "low" | "medium" | "high"}. Each piece of evidence quotes a line of the brief.`

const AnthropicReply = Schema.fromJsonString(
  Schema.Struct({
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })),
    usage: Schema.optionalKey(Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number })),
  }),
)

const ChatReply = Schema.fromJsonString(
  Schema.Struct({
    choices: Schema.Array(Schema.Struct({ message: Schema.Struct({ content: Schema.NullOr(Schema.String) }) })),
    usage: Schema.optionalKey(Schema.Struct({ total_tokens: Schema.Number })),
  }),
)

const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(ModelAnswer))

/** The JSON object in what the model wrote, past any prose or code fence around it. */
const objectIn = (text: string): string => text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)

/** Evidence links only to web pages: a model's `javascript:` or file link is dropped, the evidence kept. */
const safely = (answer: ModelAnswer): ModelAnswer => ({
  ...answer,
  evidence: answer.evidence.map(({ text, href }) =>
    href !== undefined && /^https?:\/\//i.test(href) ? { text, href } : { text },
  ),
})

const keyOf = (ai: Ai) => (ai.apiKey === undefined ? undefined : Redacted.value(ai.apiKey))

const chatBase = (ai: Ai): string => {
  if (ai.url !== undefined) return ai.url.replace(/\/$/, "")
  if (ai.provider === "xai") return "https://api.x.ai/v1"
  if (ai.provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai"
  return "https://api.openai.com/v1"
}

const callOf = (ai: Ai, user: string): Call => {
  const key = keyOf(ai)
  if (ai.provider === "anthropic")
    return {
      url: `${(ai.url ?? "https://api.anthropic.com").replace(/\/$/, "")}/v1/messages`,
      method: "POST",
      timeout: thinking,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2023-06-01",
        ...(key === undefined ? {} : { "x-api-key": key }),
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: longest,
        system,
        messages: [{ role: "user", content: user }],
      }),
    }
  return {
    url: `${chatBase(ai)}/chat/completions`,
    method: "POST",
    timeout: thinking,
    headers: { "content-type": "application/json", ...(key === undefined ? {} : { authorization: `Bearer ${key}` }) },
    body: JSON.stringify({
      model: ai.model,
      max_tokens: longest,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  }
}

/** The text a provider answered with, and the tokens it says it used. */
const readReply = (ai: Ai, text: string) =>
  ai.provider === "anthropic"
    ? Effect.map(Schema.decodeUnknownEffect(AnthropicReply)(text), (reply) => ({
        text: reply.content.find((each) => each.type === "text")?.text ?? "",
        tokens: (reply.usage?.input_tokens ?? 0) + (reply.usage?.output_tokens ?? 0),
      }))
    : Effect.map(Schema.decodeUnknownEffect(ChatReply)(text), (reply) => ({
        text: reply.choices[0]?.message.content ?? "",
        tokens: reply.usage?.total_tokens ?? 0,
      }))

const named = (ai: Ai) => (ai.provider === "anthropic" ? "Anthropic" : "the model")

const askWith = (remote: Remote, ai: Ai, brief: string, question: string) =>
  Effect.gen(function* () {
    const reply = yield* remote
      .call(callOf(ai, `Brief:\n${brief}\n\nQuestion: ${question}`))
      .pipe(Effect.mapError((error) => new ModelError({ message: error.message })))
    if (reply.status < 200 || reply.status > 299)
      return yield* new ModelError({ message: `${named(ai)} answered ${reply.status}` })
    const { text, tokens } = yield* readReply(ai, reply.text).pipe(
      Effect.mapError(() => new ModelError({ message: `${named(ai)}'s reply was not in its API's shape` })),
    )
    const answer = yield* decodeAnswer(objectIn(text)).pipe(
      Effect.mapError(() => new ModelError({ message: "the model did not answer in the shape it was asked for" })),
    )
    return { answer: safely(answer), model: ai.model, tokens }
  })

/** The model `settings.ai` names; without one, every ask fails saying so. */
export const liveModel = (ai: Ai | undefined): Layer.Layer<Model, never, Remote> =>
  Layer.effect(Model)(
    Effect.gen(function* () {
      const remote = yield* Remote
      return {
        ask: (brief: string, question: string) =>
          ai === undefined
            ? Effect.fail(new ModelError({ message: "Ask AI is not configured" }))
            : askWith(remote, ai, brief, question),
      }
    }),
  )
