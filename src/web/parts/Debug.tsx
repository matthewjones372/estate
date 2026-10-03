/** @jsxImportSource solid-js */
/** A service's debug switch: on for a while under someone's name, then off by itself. */
import { createSignal, For, Show } from "solid-js"
import type { CatalogEvent, ServiceState } from "../../shared/events"
import { useEstate } from "../context"
import { clock } from "../format"

const spans = [
  { label: "15 min", minutes: 15 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
] as const

export const DebugPanel = (props: {
  readonly service: CatalogEvent["services"][number]
  readonly state: ServiceState | undefined
}) => {
  const { me, actions, now } = useEstate()
  const [minutes, setMinutes] = createSignal<number>(15)
  const [confirming, setConfirming] = createSignal(false)
  const debug = () => props.state?.debug
  const operator = me.role === "operator"
  return (
    <Show
      when={props.service.debug?.levels}
      fallback={
        <p class="muted" style={{ margin: 0 }}>
          The catalog names no log level for {props.service.name}, so it cannot be switched here.
        </p>
      }
    >
      {(levels) => (
        <div class="stack">
          <div class="spread">
            <span class="mono">{debug()?.level ?? levels()[0]}</span>
          </div>
          <Show
            when={debug()?.on === true ? debug() : undefined}
            fallback={
              <div class="stack">
                <p class="secondary" style={{ margin: 0, "font-size": "13px" }}>
                  Off: it logs at {debug()?.level ?? levels()[0]}.
                </p>
                <Show when={operator}>
                  <fieldset class="choices bare">
                    <legend class="visually-hidden">For how long</legend>
                    <For each={spans}>
                      {(span) => (
                        <button
                          type="button"
                          aria-pressed={minutes() === span.minutes}
                          class="choice debug-choice"
                          onClick={() => setMinutes(span.minutes)}
                        >
                          {span.label}
                        </button>
                      )}
                    </For>
                  </fieldset>
                  <Show when={!confirming()}>
                    <button type="button" class="debug-button" onClick={() => setConfirming(true)}>
                      Turn on debug…
                    </button>
                  </Show>
                </Show>
              </div>
            }
          >
            {(on) => (
              <div class="debug-on stack">
                <strong>On until {on().until === undefined ? "switched off" : clock(on().until ?? "")}</strong>
                <span class="secondary" style={{ "font-size": "13px" }}>
                  Turned on{on().by === undefined ? "" : ` by ${on().by}`}
                  {on().since === undefined ? "" : ` at ${clock(on().since ?? "")}`}. It turns itself off then; nobody
                  needs to remember.
                </span>
                <Show when={operator}>
                  <button
                    type="button"
                    class="plain-button"
                    style={{ "align-self": "flex-start" }}
                    onClick={() => void actions.undebug(props.service.name)}
                  >
                    Turn off now
                  </button>
                </Show>
              </div>
            )}
          </Show>
          <Show when={confirming()}>
            <div role="alertdialog" aria-labelledby="confirm-title" class="debug-confirm stack">
              <strong id="confirm-title">
                {levels().at(-1) ?? "DEBUG"} for {props.service.name},{" "}
                {spans.find((span) => span.minutes === minutes())?.label}?
              </strong>
              <p class="secondary" style={{ margin: 0, "font-size": "13px" }}>
                Many more lines, and more disk in the log store. It is recorded under your name, and ends at{" "}
                {clock(new Date(now() + minutes() * 60_000).toISOString())}.
              </p>
              <div class="choices">
                <button
                  type="button"
                  class="debug-button"
                  onClick={() => void actions.debug(props.service.name, minutes()).then(() => setConfirming(false))}
                >
                  Turn on
                </button>
                <button type="button" class="plain-button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </Show>
        </div>
      )}
    </Show>
  )
}
