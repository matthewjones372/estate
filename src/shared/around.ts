/**
 * What `GET /api/alerts/around` answers: an alert's brief, gathered from what Estate already knows of the estate,
 * before anyone, or any model, is asked to think about it.
 */
import { Schema } from "effect"
import { ErrorGroups } from "./log-events"

const optional = Schema.optionalKey
const Instant = Schema.String
const Health = Schema.Literals(["healthy", "attention", "critical", "unknown"])

/** A deploy or build of the alert's service, or of what it calls or what calls it, near when it fired. */
const Change = Schema.Struct({
  at: Instant,
  service: Schema.String,
  kind: Schema.Literals(["deploy", "build"]),
  text: Schema.String,
  url: optional(Schema.String),
})

/** A reading as it is now: a stat of a store, or a service's requests, errors or p99. */
const Reading = Schema.Struct({
  title: Schema.String,
  now: Schema.NullOr(Schema.Number),
  unit: optional(Schema.String),
})

/** What sits next to it on the map, and how it is. */
const Neighbour = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["service", "store"]),
  /** Whether the alert's subject calls it, or it calls the alert's subject. */
  side: Schema.Literals(["calls", "called by"]),
  health: Health,
  reasons: Schema.Array(Schema.String),
  readings: Schema.Array(Reading),
})

export const AroundAlert = Schema.Struct({
  alert: Schema.String,
  name: Schema.String,
  startsAt: Instant,
  summary: optional(Schema.String),
  /** What it means for the people using the product, as its card says. */
  impact: optional(Schema.String),
  /** The service or store it is about, if Estate could tell. */
  subject: optional(Schema.String),
  changed: Schema.Array(Change),
  depends: Schema.Array(Neighbour),
  /** Its service's errors from ten minutes before it fired; why not, where they could not be read. */
  errors: optional(Schema.Union([ErrorGroups, Schema.Struct({ failed: Schema.String })])),
  before: Schema.Array(
    Schema.Struct({
      startsAt: Instant,
      endsAt: optional(Instant),
      silence: optional(Schema.Struct({ by: Schema.String, reason: Schema.String })),
      notes: Schema.Array(Schema.Struct({ by: Schema.String, at: Instant, text: Schema.String })),
    }),
  ),
  /** Its runbook's link, and its text where Estate could read it, or why not. */
  runbook: optional(
    Schema.Struct({ url: Schema.String, text: optional(Schema.String), failed: optional(Schema.String) }),
  ),
})
export type AroundAlert = typeof AroundAlert.Type
export type Neighbour = typeof Neighbour.Type
export type Change = typeof Change.Type
