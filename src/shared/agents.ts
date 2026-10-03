/** An AI agent as the events carry it: its usage over the last hour, its tokens against its budget, and its model. */
import { Schema } from "effect"
import { Series } from "./workloads"

const optional = Schema.optionalKey
const Instant = Schema.String

export const AgentUsage = Schema.Struct({
  runs: optional(Series),
  errors: optional(Series),
  p99: optional(Series),
  tokens: optional(Series),
  /** Tokens spent over the budget's period, the last day or month; null where the source had nothing. */
  spent: optional(Schema.NullOr(Schema.Number)),
  model: optional(Schema.String),
  /** When the model was last seen to change, and the one before. */
  modelSince: optional(Instant),
  modelWas: optional(Schema.String),
})
export type AgentUsage = typeof AgentUsage.Type

export const DescribedAgent = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  owner: optional(Schema.String),
  category: optional(Schema.String),
  runbook: optional(Schema.String),
  links: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })),
  budget: optional(Schema.Struct({ tokens: Schema.Number, per: Schema.Literals(["day", "month"]) })),
  /** Whether its runs can be read, from the tool that traces them. */
  runs: optional(Schema.Boolean),
})

/** One run of an agent, as the tool that traces it says: how it went, how long, its tokens and cost, and where. */
export const AgentRun = Schema.Struct({
  id: Schema.String,
  startedAt: Instant,
  failed: Schema.Boolean,
  message: optional(Schema.String),
  seconds: optional(Schema.Number),
  tokens: optional(Schema.Number),
  cost: optional(Schema.Number),
  model: optional(Schema.String),
  url: optional(Schema.String),
})
export type AgentRun = typeof AgentRun.Type

export const AgentState = Schema.Struct({
  name: Schema.String,
  health: Schema.Literals(["healthy", "attention", "critical", "unknown"]),
  reasons: Schema.Array(Schema.String),
  usage: AgentUsage,
  pods: optional(Schema.Array(Schema.Struct({ name: Schema.String, ready: Schema.Boolean }))),
})
export type AgentState = typeof AgentState.Type

/** "6.1M", "820k": a count of tokens as the page says it. */
export const tokens = (count: number): string =>
  count >= 1_000_000
    ? `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`
    : count >= 1000
      ? `${Math.round(count / 1000)}k`
      : String(Math.round(count))
