/** @jsxImportSource solid-js */
/** Raise incident: a configured link out to PagerDuty / Opsgenie / etc. Hidden when the catalog has none. */
import { Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { fillIncident, incidentOf, type NamedLink } from "../incident"
import { Out } from "./A"

export const RaiseIncident = (props: {
  readonly alert: Pick<Alert, "name" | "summary">
  readonly links: ReadonlyArray<NamedLink> | undefined
  readonly class?: string
}) => {
  const link = () => incidentOf(props.links)
  return (
    <Show when={link()}>
      {(found) => (
        <Out
          href={fillIncident(found().url, {
            alert: props.alert.name,
            summary: props.alert.summary ?? props.alert.name,
          })}
          class={props.class ?? "amber-button ghost"}
        >
          Raise incident
        </Out>
      )}
    </Show>
  )
}
