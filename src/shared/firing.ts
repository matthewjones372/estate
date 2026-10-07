/** What `GET /api/firings/:id` answers: one past firing of an alert, as Estate kept it, for its page. */
import { Schema } from "effect"
import { Change } from "./around"
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
  /** What was around it then, from what Estate still holds; none where it was about neither service nor store. */
  around: optional(
    Schema.Struct({
      /** The deploys and builds of it and its neighbours in the hour before it fired. */
      changed: Schema.Array(Change),
      /** Services whose latest deploy Estate holds came after it fired, so ones before that are not known here. */
      unseen: Schema.Array(Schema.Struct({ service: Schema.String, version: Schema.String })),
      neighbours: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          kind: Schema.Literals(["service", "store"]),
          side: Schema.Literals(["calls", "called by"]),
        }),
      ),
    }),
  ),
})
export type PastFiring = typeof PastFiring.Type
