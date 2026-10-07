/** What `GET /api/firings/:id` answers: one past firing of an alert, as Estate kept it, for its page. */
import { Schema } from "effect"
import { Alert, Note } from "./events"

const optional = Schema.optionalKey
const Instant = Schema.String

export const PastFiring = Schema.Struct({
  environment: Schema.String,
  alert: Schema.String,
  name: Schema.String,
  service: optional(Schema.String),
  store: optional(Schema.String),
  /** What the alert said as it fired; a firing kept before Estate kept these has none. */
  severity: optional(Schema.String),
  summary: optional(Schema.String),
  runbook: optional(Schema.String),
  startsAt: Instant,
  endsAt: optional(Instant),
  silence: optional(Schema.Struct({ by: Schema.String, reason: Schema.String })),
  /** The notes written while it fired, newest first. */
  notes: Schema.Array(Note),
  /** The alert's impact as it reads now, written on the page or in the catalog. */
  impact: Alert.fields.impact,
  /** When the same alert's other firings in this environment started, newest first. */
  others: Schema.Array(Instant),
})
export type PastFiring = typeof PastFiring.Type
