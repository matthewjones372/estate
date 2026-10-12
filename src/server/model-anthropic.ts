/**
 * Anthropic's Messages API in the shape Ask AI asks through: what repeats marked for the cache, the answer held to its
 * JSON Schema, and the reply's blocks kept whole for the next turn.
 */
import { Effect, Schema } from "effect"
import { ModelAnswer } from "../shared/ask"
import { type Api, base, keyOf, thinking } from "./model-apis"
import type { Ai } from "./settings"

/** Anthropic's models think before they answer, and the thinking counts against `max_tokens`. */
const longestThinking = 8192

/** Every object in a JSON Schema closed to properties it does not name, as structured output requires. */
const closed = (schema: unknown): unknown => {
  if (Array.isArray(schema)) return schema.map(closed)
  if (typeof schema !== "object" || schema === null) return schema
  return Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, key === "additionalProperties" ? false : closed(value)]),
  )
}

/** The answer's shape, which Anthropic holds the final reply to, as `response_format` does for the chat APIs. */
const answerFormat = { type: "json_schema", schema: closed(Schema.toJsonSchemaDocument(ModelAnswer).schema) }

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
    usage: Schema.optionalKey(
      Schema.Struct({
        input_tokens: Schema.Number,
        output_tokens: Schema.Number,
        cache_read_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
        cache_creation_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      }),
    ),
  }),
)

// A reply's blocks as they came, every field kept: a thinking block must go back with its signature, and so must any
// block added later that Estate does not read.
const AnthropicBlocks = Schema.fromJsonString(Schema.Struct({ content: Schema.Array(Schema.Unknown) }))

const decodeAnthropic = Schema.decodeUnknownEffect(AnthropicReply)
const decodeAnthropicBlocks = Schema.decodeUnknownEffect(AnthropicBlocks)

const cachedHere = { type: "ephemeral" } as const

/** A message with its last block marked for the cache, its text made a block if it was a string. */
const markedForCache = (message: unknown): unknown => {
  if (typeof message !== "object" || message === null || !("content" in message)) return message
  const { content } = message
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []
  const last = blocks.at(-1)
  if (typeof last !== "object" || last === null) return message
  return { ...message, content: [...blocks.slice(0, -1), { ...last, cache_control: cachedHere }] }
}

// What repeats is marked for the cache: the system prompt (and the tools before it), the brief, and the newest message,
// so each round reads all before it at the cached price and pays in full only for what is new.
const cachedMessages = (messages: ReadonlyArray<unknown>): ReadonlyArray<unknown> =>
  messages.map((message, at) => (at === 0 || at === messages.length - 1 ? markedForCache(message) : message))

export const anthropic = (ai: Ai): Api => {
  const key = keyOf(ai)
  return {
    name: "Anthropic",
    call: ({ system, messages }, offers, answerNow) => ({
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
        max_tokens: longestThinking,
        output_config: { format: answerFormat },
        system: [{ type: "text", text: system, cache_control: cachedHere }],
        messages: cachedMessages(messages),
        // The tools stay on the last round, so the cached prefix they start stays whole; the model is told not to call.
        ...(offers.length === 0
          ? {}
          : {
              tools: offers.map(({ name, description, schema }) => ({ name, description, input_schema: schema })),
              ...(answerNow ? { tool_choice: { type: "none" } } : {}),
            }),
      }),
    }),
    read: (text) =>
      Effect.map(Effect.all([decodeAnthropic(text), decodeAnthropicBlocks(text)]), ([reply, blocks]) => ({
        text: reply.content
          .flatMap((block) => (block.type === "text" && block.text !== undefined ? [block.text] : []))
          .join(""),
        calls: reply.content.flatMap((block) =>
          block.type === "tool_use" && block.id !== undefined && block.name !== undefined
            ? [{ id: block.id, name: block.name, input: block.input ?? {} }]
            : [],
        ),
        usage: {
          // Writing to the cache is paid as input; reading from it is what is cheap.
          input: (reply.usage?.input_tokens ?? 0) + (reply.usage?.cache_creation_input_tokens ?? 0),
          cached: reply.usage?.cache_read_input_tokens ?? 0,
          output: reply.usage?.output_tokens ?? 0,
        },
        kept: { role: "assistant", content: blocks.content },
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
