/** An incident: firings a person linked as one problem, who opened it and when, and how it ended once closed. */
import { Schema } from "effect"
import { Note } from "./note"
import { FiringEvent } from "./timeline"

const optional = Schema.optionalKey
const Instant = Schema.String

export const Incident = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  openedBy: Schema.String,
  openedAt: Instant,
  closedBy: optional(Schema.String),
  closedAt: optional(Instant),
  /** How it ended, in the words of whoever closed it. */
  ended: optional(Schema.String),
  /** The same incident in the incident tool, if it is kept there too. */
  link: optional(Schema.String),
  /** Its firings, from any environment; a firing is in one incident at most. */
  firings: Schema.Array(
    Schema.Struct({
      environment: Schema.String,
      alert: Schema.String,
      /** The alert's name as it fired, for a page that cannot read the alert from another environment. */
      name: optional(Schema.String),
      startsAt: Instant,
      linkedBy: Schema.String,
      linkedAt: Instant,
    }),
  ),
  /** Notes written on the incident, oldest first; none on a record kept before it held notes. */
  notes: optional(Schema.Array(Note)),
  /** Firings a person said are not part of it, so they are not suggested for it again. */
  dismissed: optional(
    Schema.Array(
      Schema.Struct({
        environment: Schema.String,
        alert: Schema.String,
        startsAt: Instant,
        by: Schema.String,
        at: Instant,
      }),
    ),
  ),
})
export type Incident = typeof Incident.Type

/** One of an incident's events, saying which of its firings it was on. */
export const IncidentEvent = Schema.Struct({ ...FiringEvent.fields, environment: Schema.String, alert: Schema.String })
export type IncidentEvent = typeof IncidentEvent.Type

/** An incident as its page reads it: the record, and every event of its firings merged in time order. */
export const IncidentRecord = Schema.Struct({ incident: Incident, events: Schema.Array(IncidentEvent) })
export type IncidentRecord = typeof IncidentRecord.Type

/** An open incident a live firing may belong to, the firing of it that it is like, how, and how far apart they started. */
export const Suggested = Schema.Struct({
  incident: Schema.Struct({ id: Schema.String, title: Schema.String }),
  why: Schema.Literals(["same alert", "same service", "same store", "next to it"]),
  to: Schema.Struct({ environment: Schema.String, alert: Schema.String, name: Schema.String }),
  /** Minutes from the incident's firing's start to this one's: negative when this one started first. */
  apart: Schema.Number,
})
export type Suggested = typeof Suggested.Type
