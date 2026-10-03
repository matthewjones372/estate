/** What runs: pods, jobs and their runs, a service's debug, and a metric over the last hour, as the events carry them. */
import { Schema } from "effect"

const optional = Schema.optionalKey
const Instant = Schema.String

/** A metric now and over the last hour, a point a minute; null where the source had nothing. */
export const Series = Schema.Struct({
  now: Schema.NullOr(Schema.Number),
  points: Schema.Array(Schema.NullOr(Schema.Number)),
})
export type Series = typeof Series.Type

export const Pod = Schema.Struct({
  name: Schema.String,
  phase: Schema.String,
  ready: Schema.Boolean,
  restarts: Schema.Number,
  image: optional(Schema.String),
  node: optional(Schema.String),
  startedAt: optional(Instant),
})
export type Pod = typeof Pod.Type

const JobRun = Schema.Struct({
  name: Schema.String,
  outcome: Schema.Literals(["running", "succeeded", "failed"]),
  startedAt: Instant,
  finishedAt: optional(Instant),
  message: optional(Schema.String),
})

export const Job = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["CronJob", "Job", "ScheduledTask"]),
  schedule: optional(Schema.String),
  suspended: Schema.Boolean,
  runs: Schema.Array(JobRun),
  next: optional(Instant),
  missed: optional(Instant),
  /** Why it has no runs to show: the catalog names it, and the cluster has no such thing. */
  absent: optional(Schema.String),
})
export type Job = typeof Job.Type

export const Debug = Schema.Struct({
  level: Schema.String,
  on: Schema.Boolean,
  since: optional(Instant),
  until: optional(Instant),
  by: optional(Schema.String),
})
export type Debug = typeof Debug.Type
