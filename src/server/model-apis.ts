/**
 * The two APIs a model is asked through, as one shape: how a conversation starts, how it is sent, what came back
 * (text, tools to call, tokens), and how the tools' answers are added to it. Here, that shape and the Chat Completions
 * API of OpenAI, xAI, Gemini and self-hosted servers; Anthropic's Messages API is in `model-anthropic.ts`.
 */
import { Duration, Effect, Option, Redacted, Schema } from "effect"
import type { Call } from "./remote"
import type { Ai } from "./settings"

/** A tool the model may call: its name, what it answers, and its parameters as JSON Schema. */
export interface ToolOffer {
  readonly name: string
  readonly description: string
  readonly schema: unknown
}

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

/** Tokens as they are paid for: input sent at full price, input read from the cache, and output. */
export interface Usage {
  readonly input: number
  readonly cached: number
  readonly output: number
}

export const noUsage: Usage = { input: 0, cached: 0, output: 0 }

export const added = (one: Usage, other: Usage): Usage => ({
  input: one.input + other.input,
  cached: one.cached + other.cached,
  output: one.output + other.output,
})

/** One reply: the text written, the tools asked for, the tokens it took, and itself as the conversation keeps it. */
export interface Turn {
  readonly text: string
  readonly calls: ReadonlyArray<ToolCall>
  readonly usage: Usage
  readonly kept: unknown
}

/** What the model is told to be, and the messages so far, in the API's own shape. */
export interface Conversation {
  readonly system: string
  readonly messages: ReadonlyArray<unknown>
}

export interface Api {
  readonly name: string
  /** A call offering tools; with `answerNow`, the model may no longer call them and answers with what it has. */
  readonly call: (conversation: Conversation, offers: ReadonlyArray<ToolOffer>, answerNow: boolean) => Call
  readonly read: (text: string) => Effect.Effect<Turn, Schema.SchemaError>
  /** The conversation with a reply and its tools' answers, by call id, added. */
  readonly answered: (
    conversation: Conversation,
    turn: Turn,
    results: ReadonlyArray<{ readonly id: string; readonly content: string }>,
  ) => Conversation
}

/** A conversation's start: the system prompt, and the question asked. */
export const started = (system: string, user: string): Conversation => ({
  system,
  messages: [{ role: "user", content: user }],
})

/** A model reads before it answers, so it is given longer than a tool's API. */
export const thinking = Duration.seconds(60)
const longest = 1024
const ChatReply = Schema.fromJsonString(
  Schema.Struct({
    choices: Schema.Array(
      Schema.Struct({
        message: Schema.Struct({
          content: Schema.NullOr(Schema.String),
          tool_calls: Schema.optionalKey(
            Schema.Array(
              Schema.Struct({
                id: Schema.String,
                function: Schema.Struct({ name: Schema.String, arguments: Schema.String }),
              }),
            ),
          ),
        }),
      }),
    ),
    usage: Schema.optionalKey(
      Schema.Struct({
        total_tokens: Schema.Number,
        prompt_tokens: Schema.optionalKey(Schema.Number),
        completion_tokens: Schema.optionalKey(Schema.Number),
        prompt_tokens_details: Schema.optionalKey(
          Schema.NullOr(Schema.Struct({ cached_tokens: Schema.optionalKey(Schema.Number) })),
        ),
      }),
    ),
  }),
)

const Refusal = Schema.fromJsonString(Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }))

const decodeRefusal = Schema.decodeUnknownOption(Refusal)

/** What a provider said when it refused a call, cut short, if it said it in the shape both APIs use. */
export const refusalOf = (text: string): string | undefined =>
  Option.getOrUndefined(Option.map(decodeRefusal(text), (refused) => refused.error.message.slice(0, 200)))
const decodeChat = Schema.decodeUnknownEffect(ChatReply)
const decodeArguments = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

export const keyOf = (ai: Ai) => (ai.apiKey === undefined ? undefined : Redacted.value(ai.apiKey))
export const base = (url: string) => url.replace(/\/$/, "")

const chatBase = (ai: Ai): string => {
  if (ai.url !== undefined) return base(ai.url)
  if (ai.provider === "xai") return "https://api.x.ai/v1"
  if (ai.provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai"
  return "https://api.openai.com/v1"
}

type ChatUsage = NonNullable<(typeof ChatReply.Type)["usage"]>

/** A chat reply's tokens; a server that gives only the total has it counted as input. */
const chatUsage = (usage: ChatUsage | undefined): Usage => {
  if (usage === undefined) return noUsage
  if (usage.prompt_tokens === undefined || usage.completion_tokens === undefined)
    return { ...noUsage, input: usage.total_tokens }
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  return { input: usage.prompt_tokens - cached, cached, output: usage.completion_tokens }
}

export const chat = (ai: Ai): Api => {
  const key = keyOf(ai)
  return {
    name: "the model",
    // The chat APIs cache a repeated prefix without being asked; the last round is offered no tools.
    call: ({ system, messages }, offered, answerNow) => {
      const offers = answerNow ? [] : offered
      return {
        url: `${chatBase(ai)}/chat/completions`,
        method: "POST",
        timeout: thinking,
        headers: {
          "content-type": "application/json",
          ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
        },
        body: JSON.stringify({
          model: ai.model,
          max_tokens: longest,
          response_format: { type: "json_object" },
          messages: [{ role: "system", content: system }, ...messages],
          ...(offers.length === 0
            ? {}
            : {
                tools: offers.map(({ name, description, schema }) => ({
                  type: "function",
                  function: { name, description, parameters: schema },
                })),
              }),
        }),
      }
    },
    read: (text) =>
      Effect.gen(function* () {
        const reply = yield* decodeChat(text)
        const message = reply.choices[0]?.message ?? { content: null }
        const calls = yield* Effect.forEach(message.tool_calls ?? [], (call) =>
          Effect.map(decodeArguments(call.function.arguments), (input) => ({
            id: call.id,
            name: call.function.name,
            input,
          })),
        )
        return {
          text: message.content ?? "",
          calls,
          usage: chatUsage(reply.usage),
          kept: {
            role: "assistant",
            content: message.content,
            ...(message.tool_calls === undefined ? {} : { tool_calls: message.tool_calls }),
          },
        }
      }),
    answered: (conversation, turn, results) => ({
      ...conversation,
      messages: [
        ...conversation.messages,
        turn.kept,
        ...results.map(({ id, content }) => ({ role: "tool", tool_call_id: id, content })),
      ],
    }),
  }
}
