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
  "incident-noted",
  "incident-note-removed",
  "incident-dismissed",
  "incident-raised",
  "service-added",
  "deployed",
  "chosen",
  "build",
  "restarted",
  "scaled",
  "health-changed",
  "debug",
  "job",
])
export type EventKind = typeof EventKind.Type

/** Seen live while it happened, rebuilt from what Estate held when an incident opened, or written by a person later. */
export const EventSource = Schema.Literals(["seen", "rebuilt", "written"])
export type EventSource = typeof EventSource.Type

export const FiringEvent = Schema.Struct({
  id: Schema.String,
  /** When it happened, to the second, in UTC. */
  at: Schema.String,
  /** When Estate kept it: the same as `at` for what it saw live. */
  recordedAt: Schema.String,
  source: EventSource,
  /** The service or store it is about, where there is one. */
  service: Schema.optionalKey(Schema.String),
  /** The signed-in person's name, or Estate for what it saw. */
  by: Schema.String,
  kind: EventKind,
  /** What it said: a note's text, a silence's span and reason, the AI's likely cause, an incident's title. */
  text: Schema.String,
  link: Schema.optionalKey(Schema.String),
  /** On `ai-answered` only: whether the answer read the service's logs, so a reader who may not can be kept from it. */
  readLogs: Schema.optionalKey(Schema.Boolean),
  /** Its text is kept from this reader: an AI's answer drawn from logs they may not read. */
  withheld: Schema.optionalKey(Schema.Boolean),
})
export type FiringEvent = typeof FiringEvent.Type

/** An event as Estate saw it happen, kept when it happened. */
export const seenLive = <A extends Omit<FiringEvent, "recordedAt" | "source">>(event: A) =>
  ({ ...event, recordedAt: event.at, source: "seen" }) as const

/** Events as Estate saw them happen, each kept when it happened. */
export const allSeenLive = <A extends Omit<FiringEvent, "recordedAt" | "source">>(events: ReadonlyArray<A>) =>
  events.map(seenLive)

/**
 * The events as this reader may see them: an answer drawn from logs they may not read keeps only that it was. An
 * answer with no mark, kept before answers were marked, is taken to have read them.
 */
export const seenBy = <A extends FiringEvent>(events: ReadonlyArray<A>, readsLogs: boolean): ReadonlyArray<A> =>
  readsLogs
    ? events
    : events.map((event) =>
        event.kind === "ai-answered" && event.readLogs !== false ? { ...event, text: "", withheld: true } : event,
      )

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
      return event.withheld === true ? "AI answered from logs only operators read" : `AI answered: ${event.text}`
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
    case "incident-noted":
      return `noted on the incident: ${event.text}`
    case "incident-note-removed":
      return `removed from the incident ${event.text}`
    case "incident-dismissed":
      return `said not part of incident "${event.text}"`
    case "incident-raised":
      return `raised in ${event.text}`
    case "service-added":
      return `added ${event.text} to the incident`
    // What Estate saw change around an incident says it whole.
    case "deployed":
    case "chosen":
    case "build":
    case "restarted":
    case "scaled":
    case "health-changed":
    case "debug":
    case "job":
      return event.text
  }
}

/** Whether an event was on the incident rather than one firing: kept on each of its firings, the same each time. */
export const onIncident = (event: Pick<FiringEvent, "kind">) =>
  event.kind === "incident-noted" ||
  event.kind === "incident-note-removed" ||
  event.kind === "incident-closed" ||
  event.kind === "incident-raised"

/**
 * An incident's events from all its firings, in time order, with an event on the incident shown once: its copies
 * share their kind, time, person and text, though each firing's copy has its own id.
 */
export const mergedOnce = <A extends FiringEvent>(events: ReadonlyArray<A>): ReadonlyArray<A> => {
  const seen = new Set<string>()
  return events
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .filter((event) => {
      if (!onIncident(event)) return true
      const key = JSON.stringify([event.kind, Date.parse(event.at), event.by, event.text])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
