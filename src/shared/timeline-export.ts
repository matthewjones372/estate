/**
 * What `GET /api/firings/:id/timeline?format=json` and `GET /api/incidents/:id/timeline?format=json` answer: a
 * firing's or an incident's record for a review, the same content as the Markdown, as data. Times are UTC.
 */
import { Schema } from "effect"
import { Note } from "./note"
import { FiringEvent } from "./timeline"

const optional = Schema.optionalKey
const Instant = Schema.String

export const ExportedFiring = Schema.Struct({
  environment: Schema.String,
  alert: Schema.String,
  name: Schema.String,
  service: optional(Schema.String),
  store: optional(Schema.String),
  severity: optional(Schema.String),
  summary: optional(Schema.String),
  startsAt: Instant,
  /** When it resolved; none while it still fires, or where its end was not seen. */
  endsAt: optional(Instant),
  /** Whether it is firing now, so a missing end reads as still firing rather than unseen. */
  firing: Schema.Boolean,
  impact: optional(Schema.String),
  /** The notes kept while it fired, oldest first, in full; its incident's are the incident's. */
  notes: Schema.Array(Note),
})
export type ExportedFiring = typeof ExportedFiring.Type

export const TimelineExport = Schema.Struct({
  /** The firing's alert name, or the incident's title. */
  title: Schema.String,
  incident: optional(
    Schema.Struct({
      id: Schema.String,
      openedBy: Schema.String,
      openedAt: Instant,
      closedBy: optional(Schema.String),
      closedAt: optional(Instant),
      ended: optional(Schema.String),
      link: optional(Schema.String),
      /** Notes written on the incident, oldest first, in full; each firing's own are with the firing. */
      notes: optional(Schema.Array(Note)),
    }),
  ),
  firings: Schema.Array(ExportedFiring),
  /** Every event in time order; on an incident's, each names the alert it was on. */
  events: Schema.Array(Schema.Struct({ ...FiringEvent.fields, alert: optional(Schema.String) })),
})
export type TimelineExport = typeof TimelineExport.Type
