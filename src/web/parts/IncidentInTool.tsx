/** @jsxImportSource solid-js */
/**
 * The incident in the incident tool (spec 0043): for an operator, *Raise in PagerDuty* while it is open and not yet
 * raised; once it is, a line linking to it there.
 */
import { createSignal, Show } from "solid-js"
import type { Incident } from "../../shared/incidents"
import { useEstate } from "../context"
import { Out } from "./A"
import { canKeepIncidents } from "./IncidentLink"

export const IncidentInTool = (props: { readonly incident: Incident; readonly changed: () => void }) => {
  const { me, actions } = useEstate()
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const raisable = () => (canKeepIncidents(me) && props.incident.closedAt === undefined ? me.incidentTool : undefined)
  const raise = () => {
    if (busy()) return
    setBusy(true)
    setRefused(undefined)
    void actions.raiseIncident(props.incident.id).then((result) => {
      setBusy(false)
      if (typeof result === "string") setRefused(result)
      else props.changed()
    })
  }
  const raised = () => {
    const { raised, link } = props.incident
    return raised === undefined || link === undefined ? undefined : { tool: raised.tool, link }
  }
  return (
    <Show
      when={raised()}
      fallback={
        <Show when={raisable()}>
          {(tool) => (
            <div class="choices incident-tool">
              <button type="button" class="primary-button" disabled={busy()} aria-busy={busy()} onClick={raise}>
                <Show when={busy()} fallback={`Raise in ${tool()}`}>
                  <span class="ask-spinner" aria-hidden="true" />
                  Raising…
                </Show>
              </button>
              <Show when={refused()}>
                {(why) => (
                  <p class="alert-detail" role="alert">
                    {why()}
                  </p>
                )}
              </Show>
            </div>
          )}
        </Show>
      }
    >
      {(found) => (
        <p class="incident-tool">
          In {found().tool}: <Out href={found().link}>Open in {found().tool}</Out>
        </p>
      )}
    </Show>
  )
}
