/** @jsxImportSource solid-js */
/** One line of a timeline: when, to the second, who, and what was done; on an incident's, which alert it was on. */
import { Show } from "solid-js"
import { type FiringEvent, said } from "../../shared/timeline"
import { instant } from "../format"
import { Out } from "./A"
import { NoteText } from "./NoteText"

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
