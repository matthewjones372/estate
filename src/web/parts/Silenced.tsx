/** @jsxImportSource solid-js */
/**
 * What is silenced, each with who silenced it, until when and why, and *Unsilence* for an operator: on the overview,
 * a service's and a store's page, and a silenced alert's own card (spec 0065).
 */
import { For, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { useEstate } from "../context"
import { clock } from "../format"
import { Icon } from "./icons"

export const Silenced = (props: { readonly alerts: ReadonlyArray<Alert>; readonly canSilence: boolean }) => {
  const { actions } = useEstate()
  return (
    <div class="stack close">
      <For each={props.alerts}>
        {(alert) => (
          <Show when={alert.silence}>
            {(silence) => (
              <div class="silenced-row">
                <Icon name="silence" />
                <span class="mono ink-soft">{alert.name}</span>
                <span>
                  silenced until {clock(silence().endsAt)} by {silence().by}: “{silence().reason}”
                </span>
                <Show when={props.canSilence}>
                  <button
                    type="button"
                    class="plain-button push-right"
                    onClick={() => void actions.unsilence(silence().id)}
                  >
                    Unsilence
                  </button>
                </Show>
              </div>
            )}
          </Show>
        )}
      </For>
    </div>
  )
}
