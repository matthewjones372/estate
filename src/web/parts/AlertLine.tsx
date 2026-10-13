/** @jsxImportSource solid-js */
/** What a row about an alert says, shared by the rows of many alerts and the Alerts table: its dot and latest note. */
import { Show } from "solid-js"
import type { Alert } from "../../shared/events"

export const firstLine = (text: string) => text.split("\n")[0] ?? ""

/** Red for critical and amber for the rest while it fires; grey once pending or silenced. */
export const SeverityDot = (props: { readonly alert: Alert }) => (
  <span
    class={`dot ${props.alert.state === "firing" ? (props.alert.severity === "critical" ? "critical" : "attention") : "unknown"}`}
  />
)

/** The latest note's who and first line, so a glance says whether someone is on it. */
export const LatestNote = (props: { readonly note: Alert["notes"][number] | undefined }) => (
  <Show when={props.note} fallback={<span class="muted">no notes</span>}>
    {(note) => (
      <span class="latest-note">
        {note().by}: “{firstLine(note().text)}”
      </span>
    )}
  </Show>
)

const severities = ["critical", "warning"]

/** Critical first, then warning, then any other. */
export const rankOf = (alert: Alert) => {
  const at = severities.indexOf(alert.severity)
  return at === -1 ? severities.length : at
}

/** Worst first; the earlier one fired, the sooner. */
export const worstFirst = (a: Alert, b: Alert) =>
  rankOf(a) - rankOf(b) || Date.parse(a.startsAt) - Date.parse(b.startsAt)
