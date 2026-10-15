/** @jsxImportSource solid-js */
/**
 * *May belong*, under an open incident's firings (spec 0042): the live firings, in any environment, suggested for it,
 * each with its reason, *Link* and *Not this*, for someone who may link. The page reads the incident again after either.
 */
import { For, Show } from "solid-js"
import type { IncidentRecord } from "../../shared/incidents"
import { useEstate } from "../context"
import { canKeepIncidents } from "./IncidentLink"
import { reasonOf, Suggestion } from "./MayBelong"

export const IncidentMayBelong = (props: { readonly record: IncidentRecord; readonly changed: () => void }) => {
  const { me } = useEstate()
  const listed = () =>
    canKeepIncidents(me) && props.record.incident.closedAt === undefined ? (props.record.suggested ?? []) : []
  return (
    <Show when={listed().length > 0}>
      <section aria-labelledby="incident-may-belong" class="panel section-box stack incident-may-belong">
        <h2 id="incident-may-belong" class="section-title">
          May belong
        </h2>
        <ul class="stack" style={{ margin: 0, padding: 0, "list-style": "none", gap: "6px" }}>
          <For each={listed()}>
            {(firing) => (
              <li>
                <Suggestion
                  line={`${firing.name} · ${firing.environment}: ${reasonOf({ ...firing, incident: { id: props.record.incident.id, title: props.record.incident.title } }, firing.about)}.`}
                  incident={props.record.incident.id}
                  alert={firing.alert}
                  environment={firing.environment}
                  done={props.changed}
                />
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  )
}
