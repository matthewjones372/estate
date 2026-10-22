/** @jsxImportSource solid-js */
/** A service's or a store's alerts over the last day, each a bar from when it fired to when it ended. */
import { For, Show } from "solid-js"
import { clock } from "../format"
import { firingPath, pathOf } from "../route"
import { A } from "./A"

const day = 24 * 3_600_000

export const Timeline = (props: {
  readonly alerts: ReadonlyArray<{
    readonly id: string
    readonly name: string
    readonly startsAt: string
    readonly endsAt?: string
  }>
  readonly now: number
}) => {
  const place = (iso: string) => Math.max(0, Math.min(100, ((Date.parse(iso) - (props.now - day)) / day) * 100))
  return (
    <div class="stack close">
      <Show when={props.alerts.length === 0}>
        <p class="muted flush">Nothing fired in the last day.</p>
      </Show>
      <For each={props.alerts}>
        {(alert) => (
          <div class="timeline-row">
            {/* When, as text beside the name, not a bar's tooltip that a keyboard or a finger never reaches. */}
            <span class="timeline-name">
              <A
                to={
                  alert.endsAt === undefined
                    ? pathOf({ page: "alert", id: alert.id })
                    : firingPath(alert.id, alert.startsAt)
                }
                class="mono"
                style={{ "font-size": "0.75rem" }}
              >
                {alert.name}
              </A>
              <span class="muted mono tiny">
                {clock(alert.startsAt)} to {alert.endsAt === undefined ? "now" : clock(alert.endsAt)}
              </span>
            </span>
            <div class="timeline-track" aria-hidden="true">
              <span
                class={`timeline-bar ${alert.endsAt === undefined ? "live" : ""}`}
                style={{
                  left: `${place(alert.startsAt)}%`,
                  width: `${Math.max(1, place(alert.endsAt ?? new Date(props.now).toISOString()) - place(alert.startsAt))}%`,
                }}
              />
            </div>
          </div>
        )}
      </For>
      <div class="timeline-row muted mono tiny">
        <span />
        <span class="spread">
          <span>24 h ago</span>
          <span>12 h ago</span>
          <span>now</span>
        </span>
      </div>
    </div>
  )
}
