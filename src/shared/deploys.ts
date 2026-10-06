/** The `deploys` event: each service's builds, and what each environment runs and has chosen to run. */
import { Schema } from "effect"

const optional = Schema.optionalKey
const Instant = Schema.String

export const Build = Schema.Struct({
  sha: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["success", "failure", "running", "queued", "cancelled"]),
  at: Instant,
  url: Schema.String,
  /** The job that failed, where the tool names it. */
  job: optional(Schema.String),
})
export type Build = typeof Build.Type

export const DeploysEvent = Schema.Struct({
  environments: Schema.Array(Schema.String),
  services: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      builds: Schema.Array(Build),
      environments: Schema.Array(
        Schema.Struct({
          environment: Schema.String,
          seen: Schema.Boolean,
          running: optional(Schema.String),
          chosen: optional(Schema.Struct({ version: Schema.String, ready: Schema.Boolean, at: optional(Instant) })),
          stalled: optional(Schema.String),
        }),
      ),
    }),
  ),
})
export type DeploysEvent = typeof DeploysEvent.Type
