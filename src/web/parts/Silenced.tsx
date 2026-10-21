/** @jsxImportSource solid-js */
/** A silenced alert in one row: who silenced it, until when and why, and Unsilence for an operator. */
import { For, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { useEstate } from "../context"
import { clock, since } from "../format"
import { A } from "./A"
import { Icon } from "./icons"

/** What an alert is doing now, in a few words: silenced until when, or firing for how long. */
export const standing = (alert: Alert, now: number): string =>
  alert.silence === undefined ? `firing ${since(alert.startsAt, now)}` : `silenced until ${clock(alert.silence.endsAt)}`

export const SilencedRow = (props: {
  readonly alert: Alert
  readonly canSilence: boolean
  /** A link to the alert's page among other alerts; plain on its own card, which already leads there. */
  readonly linked?: boolean
}) => {
  const { actions } = useEstate()
  return (
    <Show when={props.alert.silence}>
      {(silence) => (
        <div class="silenced-row">
          <Icon name="silence" />
          <Show when={props.linked} fallback={<span class="mono ink-soft">{props.alert.name}</span>}>
            <A to={`/alerts/${encodeURIComponent(props.alert.id)}`} class="mono ink-soft">
              {props.alert.name}
            </A>
          </Show>
          <span>
            silenced until {clock(silence().endsAt)} by {silence().by}: “{silence().reason}”
          </span>
          <Show when={props.canSilence}>
            <button type="button" class="plain-button push-right" onClick={() => void actions.unsilence(silence().id)}>
              Unsilence
            </button>
          </Show>
        </div>
      )}
    </Show>
  )
}

export const SilencedAlerts = (props: { readonly alerts: ReadonlyArray<Alert>; readonly canSilence: boolean }) => (
  <div class="stack close">
    <For each={props.alerts}>{(alert) => <SilencedRow alert={alert} canSilence={props.canSilence} linked />}</For>
  </div>
)
