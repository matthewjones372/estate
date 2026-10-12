/** @jsxImportSource solid-js */
/** One line of a timeline: when, to the second, who, and what was done; on an incident's, which alert it was on. */
import { Show } from "solid-js"
import type { FiringEvent } from "../../shared/timeline"
import { instant } from "../format"
import { Out } from "./A"
import { NoteText } from "./NoteText"

/** What an event says in a line: what was done, then what it said. */
const said = (event: FiringEvent): string => {
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

/** UTC, as a review that crosses zones reads it: "2026-10-02 09:00:00 UTC". */
const utc = (iso: string) => `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")} UTC`

export const TimelineRow = (props: {
  readonly event: FiringEvent
  /** The alert it was on, where a timeline holds more than one firing. */
  readonly on?: string
}) => (
  <li>
    <time class="mono" datetime={props.event.at} title={utc(props.event.at)}>
      {instant(props.event.at)}
    </time>{" "}
    <strong class="timeline-who">{props.event.by}</strong>{" "}
    <div class="timeline-what">
      <Show when={props.on}>
        {(alert) => (
          <>
            <span class="mono timeline-on">{alert()}</span>{" "}
          </>
        )}
      </Show>
      <Show when={props.event.link} fallback={<NoteText text={said(props.event)} />}>
        {(link) => <Out href={link()}>{said(props.event)}</Out>}
      </Show>
    </div>
  </li>
)
