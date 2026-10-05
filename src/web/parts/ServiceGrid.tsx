/** @jsxImportSource solid-js */
/** Compact service cards for the overview's grid layout: denser than lanes, still through to the service page. */
import { For, Show } from "solid-js"
import type { Alert, CatalogEvent, DeploysEvent, Health, ServiceState } from "../../shared/events"
import { A } from "./A"

type Described = CatalogEvent["services"][number]

const healthWords: Readonly<Record<Health, string>> = {
  healthy: "Healthy",
  attention: "Degraded",
  critical: "Down",
  unknown: "Unknown",
}

const versionOf = (
  state: ServiceState | undefined,
  deployed: DeploysEvent["services"][number] | undefined,
  environment: string,
): string => {
  if (state?.version !== undefined && state.version !== "") return state.version
  const env = deployed?.environments.find((each) => each.environment === environment)
  return env?.running ?? env?.chosen?.version ?? "—"
}

const firingAbout = (alerts: ReadonlyArray<Alert>, name: string): ReadonlyArray<Alert> =>
  alerts.filter((alert) => alert.state === "firing" && alert.service === name)

const ServiceCard = (props: {
  readonly service: Described
  readonly state: ServiceState | undefined
  readonly deployed: DeploysEvent["services"][number] | undefined
  readonly alerts: ReadonlyArray<Alert>
  readonly environment: string
}) => {
  const health = () => props.state?.health ?? "unknown"
  const firing = () => firingAbout(props.alerts, props.service.name)
  const reason = () => props.state?.reasons[0]
  const detail = () => {
    const count = firing().length
    if (count > 0) return count === 1 ? "1 alert" : `${count} alerts`
    return reason() ?? "Nothing firing"
  }
  return (
    <A to={`/services/${encodeURIComponent(props.service.name)}`} class={`service-card ${health()}`}>
      <span class="service-card-name">{props.service.name}</span>
      <span class="health">
        <span class={`dot ${health()}`} />
        <span class={`health-word ${health()}`}>{healthWords[health()]}</span>
      </span>
      <span class="muted service-card-meta">
        <Show when={props.service.owner} fallback={<span>No owner</span>}>
          {(owner) => <span>Owned by {owner()}</span>}
        </Show>
        <span aria-hidden="true"> · </span>
        <span>{versionOf(props.state, props.deployed, props.environment)}</span>
      </span>
      <span class="muted service-card-why" title={(props.state?.reasons ?? []).join("\n")}>
        {detail()}
      </span>
    </A>
  )
}

export const ServiceGrid = (props: {
  readonly services: ReadonlyArray<Described>
  readonly states: ReadonlyMap<string, ServiceState>
  readonly deployed: ReadonlyMap<string, DeploysEvent["services"][number]>
  readonly alerts: ReadonlyArray<Alert>
  readonly environment: string
}) => {
  return (
    <ul class="service-grid">
      <For each={props.services}>
        {(service) => (
          <li>
            <ServiceCard
              service={service}
              state={props.states.get(service.name)}
              deployed={props.deployed.get(service.name)}
              alerts={props.alerts}
              environment={props.environment}
            />
          </li>
        )}
      </For>
    </ul>
  )
}
