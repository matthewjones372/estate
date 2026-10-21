/** @jsxImportSource solid-js */
/** A silenced alert in one row: who silenced it, until when and why, and Unsilence for an operator. */
import { For, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { useEstate } from "../context"
import { clock } from "../format"
import { A } from "./A"
import { Icon } from "./icons"

export const SilencedRow = (props: { readonly alert: Alert; readonly canSilence: boolean }) => {
  const { actions } = useEstate()
  return (
    <Show when={props.alert.silence}>
      {(silence) => (
        <div class="silenced-row">
          <Icon name="silence" />
          <A to={`/alerts/${encodeURIComponent(props.alert.id)}`} class="mono ink-soft">
            {props.alert.name}
          </A>
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
    <For each={props.alerts}>{(alert) => <SilencedRow alert={alert} canSilence={props.canSilence} />}</For>
  </div>
)
