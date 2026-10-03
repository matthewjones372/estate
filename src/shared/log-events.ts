/** What the logs endpoints send: a service's lines as they arrive, and its errors grouped by message. */
import { Schema } from "effect"

const optional = Schema.optionalKey
const Instant = Schema.String

/** A service's log line, as the page shows it. */
export const LogLine = Schema.Struct({
  at: Instant,
  pod: optional(Schema.String),
  level: optional(Schema.String),
  text: Schema.String,
})

export type LogLine = typeof LogLine.Type

/** What `GET /logs` sends each time it reads: the new lines, whether it had to skip some, or why it could not read. */
export const LogBatch = Schema.Struct({
  lines: Schema.Array(LogLine),
  skipped: Schema.Boolean,
  failed: optional(Schema.String),
})
export type LogBatch = typeof LogBatch.Type

/** What `GET /api/logs/errors` answers: where the lines came from, and the errors grouped by message. */
export const ErrorGroups = Schema.Struct({
  from: Schema.String,
  groups: Schema.Array(
    Schema.Struct({
      shape: Schema.String,
      count: Schema.Number,
      firstSeen: Instant,
      lastSeen: Instant,
      pods: Schema.Array(Schema.String),
      examples: Schema.Array(LogLine),
    }),
  ),
})
export type ErrorGroups = typeof ErrorGroups.Type
