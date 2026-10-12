/** What happened to a firing, who did it and when: one line of its timeline, as Estate kept it. */
import { Schema } from "effect"

export const EventKind = Schema.Literals([
  "fired",
  "resolved",
  "noted",
  "note-removed",
  "silenced",
  "unsilenced",
  "impact-written",
  "team-told",
  "ai-asked",
  "ai-answered",
  "ai-failed",
  "ai-kept",
])
export type EventKind = typeof EventKind.Type

export const FiringEvent = Schema.Struct({
  id: Schema.String,
  /** When it happened, to the second, in UTC. */
  at: Schema.String,
  /** The signed-in person's name, or Estate for what it saw. */
  by: Schema.String,
  kind: EventKind,
  /** What it said: a note's text, a silence's span and reason, the AI's likely cause. */
  text: Schema.String,
  link: Schema.optionalKey(Schema.String),
})
export type FiringEvent = typeof FiringEvent.Type
