/**
 * The two APIs a model is asked through, as one shape: how a conversation starts, how it is sent, what came back
 * (text, tools to call, tokens), and how the tools' answers are added to it. Anthropic's Messages API; and the Chat
 * Completions API of OpenAI, xAI, Gemini and self-hosted servers.
 */
import { Duration, Effect, Redacted, Schema } from "effect"
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

/** One reply: the text written, the tools asked for, the tokens it took, and itself as the conversation keeps it. */
export interface Turn {
  readonly text: string
  readonly calls: ReadonlyArray<ToolCall>
  readonly tokens: number
  readonly kept: unknown
}

/** What the model is told to be, and the messages so far, in the API's own shape. */
export interface Conversation {
  readonly system: string
  readonly messages: ReadonlyArray<unknown>
}

export interface Api {
  readonly name: string
  readonly call: (conversation: Conversation, offers: ReadonlyArray<ToolOffer>) => Call
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
const thinking = Duration.seconds(60)
const longest = 1024

const AnthropicReply = Schema.fromJsonString(
  Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.optionalKey(Schema.String),
        id: Schema.optionalKey(Schema.String),
        name: Schema.optionalKey(Schema.String),
        input: Schema.optionalKey(Schema.Unknown),
      }),
    ),
    usage: Schema.optionalKey(Schema.Struct({ input_tokens: Schema.Number, output_tokens: Schema.Number })),
  }),
)

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
    usage: Schema.optionalKey(Schema.Struct({ total_tokens: Schema.Number })),
  }),
)

const decodeAnthropic = Schema.decodeUnknownEffect(AnthropicReply)
const decodeChat = Schema.decodeUnknownEffect(ChatReply)
const decodeArguments = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

const keyOf = (ai: Ai) => (ai.apiKey === undefined ? undefined : Redacted.value(ai.apiKey))
const base = (url: string) => url.replace(/\/$/, "")

const anthropic = (ai: Ai): Api => {
  const key = keyOf(ai)
  return {
    name: "Anthropic",
    call: ({ system, messages }, offers) => ({
      url: `${base(ai.url ?? "https://api.anthropic.com")}/v1/messages`,
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
        messages,
        ...(offers.length === 0
          ? {}
          : { tools: offers.map(({ name, description, schema }) => ({ name, description, input_schema: schema })) }),
      }),
    }),
    read: (text) =>
      Effect.map(decodeAnthropic(text), (reply) => ({
        text: reply.content
          .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
          .join(""),
        calls: reply.content.flatMap((block) =>
          block.type === "tool_use" && block.id !== undefined && block.name !== undefined
            ? [{ id: block.id, name: block.name, input: block.input ?? {} }]
            : [],
        ),
        tokens: (reply.usage?.input_tokens ?? 0) + (reply.usage?.output_tokens ?? 0),
        kept: { role: "assistant", content: reply.content },
      })),
    answered: (conversation, turn, results) => ({
      ...conversation,
      messages: [
        ...conversation.messages,
        turn.kept,
        {
          role: "user",
          content: results.map(({ id, content }) => ({ type: "tool_result", tool_use_id: id, content })),
        },
      ],
    }),
  }
}

const chatBase = (ai: Ai): string => {
  if (ai.url !== undefined) return base(ai.url)
  if (ai.provider === "xai") return "https://api.x.ai/v1"
  if (ai.provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai"
  return "https://api.openai.com/v1"
}

const chat = (ai: Ai): Api => {
  const key = keyOf(ai)
  return {
    name: "the model",
    call: ({ system, messages }, offers) => ({
      url: `${chatBase(ai)}/chat/completions`,
      method: "POST",
      timeout: thinking,
      headers: { "content-type": "application/json", ...(key === undefined ? {} : { authorization: `Bearer ${key}` }) },
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
    }),
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
          tokens: reply.usage?.total_tokens ?? 0,
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

export const apiOf = (ai: Ai): Api => (ai.provider === "anthropic" ? anthropic(ai) : chat(ai))
