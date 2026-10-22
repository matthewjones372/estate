/** @jsxImportSource solid-js */
/** Alerts about a service: the "What's happening" block at the top of its page, firing ones and then silenced. */
import { Show } from "solid-js"
import type { Alert, CatalogEvent } from "../../shared/events"
import { alertsLayout, LayoutChoice } from "./AlertsLayout"
import { FiringAlerts } from "./FiringAlerts"
import { SilencedAlerts } from "./Silenced"

export const ServiceAlerts = (props: {
  readonly alerts: ReadonlyArray<Alert>
  readonly catalog: CatalogEvent | undefined
  readonly canSilence: boolean
}) => {
  const firing = () => props.alerts.filter((alert) => alert.state === "firing")
  const silenced = () => props.alerts.filter((alert) => alert.state === "silenced")
  const { layout, choose, rows } = alertsLayout()
  return (
    <section aria-labelledby="service-alerts" class="stack">
      <div class="spread">
        <h2 id="service-alerts" class="section-title">
          What's happening{firing().length === 0 ? "" : ` · ${firing().length} firing`}
        </h2>
        <Show when={firing().length > 0}>
          <LayoutChoice layout={layout()} choose={choose} />
        </Show>
      </div>
      <Show when={firing().length === 0}>
        <p class="muted flush">Nothing firing.</p>
      </Show>
      <FiringAlerts alerts={firing()} catalog={props.catalog} canSilence={props.canSilence} rows={rows(firing())} />
      <SilencedAlerts alerts={silenced()} canSilence={props.canSilence} />
    </section>
  )
}
