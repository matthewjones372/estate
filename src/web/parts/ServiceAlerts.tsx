/** @jsxImportSource solid-js */
/** Firing alerts about a service: the "What's happening" block at the top of its page. */
import { For, Show } from "solid-js"
import type { Alert, CatalogEvent } from "../../shared/events"
import { AlertCard } from "./AlertCard"

export const ServiceAlerts = (props: {
  readonly alerts: ReadonlyArray<Alert>
  readonly catalog: CatalogEvent | undefined
  readonly canSilence: boolean
}) => {
  const firing = () => props.alerts.filter((alert) => alert.state === "firing")
  return (
    <section aria-labelledby="service-alerts" class="stack">
      <h2 id="service-alerts" class="section-title">
        What's happening
      </h2>
      <Show when={firing().length === 0}>
        <p class="muted" style={{ margin: 0 }}>
          Nothing firing.
        </p>
      </Show>
      <div class="cards">
        <For each={firing()}>
          {(alert) => <AlertCard alert={alert} catalog={props.catalog} canSilence={props.canSilence} />}
        </For>
      </div>
    </section>
  )
}
