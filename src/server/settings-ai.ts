/** The settings for models and agents: the model Ask AI asks, its prices, and the agents that may ask `/mcp`. */
import { Schema } from "effect"
import { Secret } from "./secret"

const optional = Schema.optionalKey

/** A model to ask about an alert: Anthropic, OpenAI, xAI, Gemini, or any OpenAI-compatible server. */
export const Ai = Schema.Struct({
  provider: Schema.Literals(["anthropic", "openai", "openai-compatible", "xai", "gemini"]),
  apiKey: optional(Secret),
  model: Schema.String,
  url: optional(Schema.String),
  budget: optional(Schema.Struct({ tokensPerDay: optional(Schema.Number) })),
  /** How hard the model thinks: `low` unless set, sent as each provider names it, and not at all where it has none. */
  effort: optional(Schema.Literals(["low", "medium", "high"])),
  /** Rounds of Estate's read tools before the model must answer; 2 unless set. */
  toolRounds: optional(Schema.Number),
  /** The most of one tool result the model reads, in characters; 4,000 unless set. */
  toolResultChars: optional(Schema.Number),
})
export type Ai = typeof Ai.Type

/** An agent's token for `/mcp`: its name, secret, and the role it reads as. */
const McpToken = Schema.Struct({
  name: Schema.String,
  token: Secret,
  role: Schema.Literals(["viewer", "operator"]),
})
export const Mcp = Schema.Struct({ tokens: Schema.Array(McpToken) })
export type Mcp = typeof Mcp.Type
