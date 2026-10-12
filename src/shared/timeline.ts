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
  "incident-opened",
  "incident-linked",
  "incident-unlinked",
  "incident-closed",
])
export type EventKind = typeof EventKind.Type

export const FiringEvent = Schema.Struct({
  id: Schema.String,
  /** When it happened, to the second, in UTC. */
  at: Schema.String,
  /** The signed-in person's name, or Estate for what it saw. */
  by: Schema.String,
  kind: EventKind,
  /** What it said: a note's text, a silence's span and reason, the AI's likely cause, an incident's title. */
  text: Schema.String,
  link: Schema.optionalKey(Schema.String),
})
export type FiringEvent = typeof FiringEvent.Type

/** What an event says in a line, on the page and in an export: what was done, then what it said. */
export const said = (event: FiringEvent): string => {
  switch (event.kind) {
    case "fired":
      return `fired: ${event.text}`
    case "resolved":
      return `resolved ${event.text}`
    case "noted":
      return `noted: ${event.text}`
    case "note-removed":
      return `removed ${event.text}`
    case "silenced":
      return `silenced ${event.text}`
    case "unsilenced":
      return event.text
    case "impact-written":
      return `wrote the impact: ${event.text}`
    case "team-told":
      return event.text
    case "ai-asked":
      return `asked AI (${event.text})`
    case "ai-answered":
      return `AI answered: ${event.text}`
    case "ai-failed":
      return `AI could not answer: ${event.text}`
    case "ai-kept":
      return `kept the AI's answer as a note: ${event.text}`
    case "incident-opened":
      return `opened incident "${event.text}" with this firing`
    case "incident-linked":
      return `linked to incident "${event.text}"`
    case "incident-unlinked":
      return `unlinked from incident "${event.text}"`
    case "incident-closed":
      return `closed the incident: ${event.text}`
  }
}
