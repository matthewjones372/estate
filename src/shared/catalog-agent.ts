/** An AI agent in the catalog: what it is, its usage as queries, its budget, and where its runs are traced. */
import { Schema } from "effect"
import { Kubernetes } from "./catalog-parts"
import { CostOf } from "./costs"

const optional = Schema.optionalKey

/**
 * An AI agent run in production: its usage as queries of the environment's metrics (the examples in the README use
 * OpenTelemetry's GenAI metrics), its token budget, and where it runs, if Estate should show its pods.
 */
export const Agent = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  owner: optional(Schema.String),
  category: optional(Schema.String),
  /** Where its cost is found, where its name is not enough, and its budget. */
  cost: optional(CostOf),
  runbook: optional(Schema.String),
  environments: Schema.Array(Schema.String),
  runtime: optional(Schema.Struct({ kubernetes: optional(Kubernetes) })),
  usage: optional(
    Schema.Struct({
      /** Runs a second, those that failed a second, and how long the slowest take. */
      runs: optional(Schema.String),
      errors: optional(Schema.String),
      p99: optional(Schema.String),
      /** Tokens an hour now, and tokens spent over the budget's period: the last day or month. */
      tokens: optional(Schema.String),
      /** Tokens an hour in and out, priced by the settings' `prices` for the estimate of what it spends. */
      input: optional(Schema.String),
      output: optional(Schema.String),
      spent: optional(Schema.String),
      /** A query grouped by the model's label, such as `group by (gen_ai_response_model) (…)`: the model in use. */
      model: optional(Schema.String),
    }),
  ),
  budget: optional(Schema.Struct({ tokens: Schema.Number, per: Schema.Literals(["day", "month"]) })),
  /** Where its runs are traced: Langfuse's traces by their name. */
  runs: optional(Schema.Struct({ langfuse: Schema.Struct({ name: Schema.String }) })),
  /** The share of runs failing that needs someone: 0.1 unless set. */
  failing: optional(Schema.Number),
  links: optional(Schema.Record(Schema.String, Schema.String)),
})
export type Agent = typeof Agent.Type
