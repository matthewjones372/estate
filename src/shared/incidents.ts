/** An incident: firings a person linked as one problem, who opened it and when, and how it ended once closed. */
import { Schema } from "effect"

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
      startsAt: Instant,
      linkedBy: Schema.String,
      linkedAt: Instant,
    }),
  ),
})
export type Incident = typeof Incident.Type
