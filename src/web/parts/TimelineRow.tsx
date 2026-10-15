/** @jsxImportSource solid-js */
/**
 * One line of a timeline: when, to the second, who, and what was done; on an incident's, which alert it was on. What a
 * person wrote later, or Estate rebuilt, is marked, saying on hover when it was kept.
 */
import { Show } from "solid-js"
import { type FiringEvent, said } from "../../shared/timeline"
import { clock, instant } from "../format"
import { Out } from "./A"
import { NoteText } from "./NoteText"

/** UTC, as a review that crosses zones reads it: "2026-10-02 09:00:00 UTC". */
const utc = (iso: string) => `${new Date(iso).toISOString().slice(0, 19).replace("T", " ")} UTC`

const Kept = (props: { readonly event: FiringEvent }) => (
  <Show when={props.event.source !== "seen"}>
    <span
      class="timeline-source"
      title={`${props.event.source === "written" ? `written by ${props.event.by}` : `rebuilt by Estate from what it held`}, kept ${utc(props.event.recordedAt)}`}
    >
      {props.event.source === "written" ? `written ${clock(props.event.recordedAt)} ✎` : "rebuilt ↺"}
    </span>
  </Show>
)

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
      </Show>{" "}
      <Kept event={props.event} />
    </div>
  </li>
)
