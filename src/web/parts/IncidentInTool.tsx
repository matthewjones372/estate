/** @jsxImportSource solid-js */
/**
 * The incident in the incident tool (spec 0043): for an operator, *Raise in PagerDuty* while it is open and not yet
 * raised; once it is, what the tool says of it and a link to it there.
 */
import { createSignal, Show } from "solid-js"
import type { Incident, ReadBack } from "../../shared/incidents"
import { useEstate } from "../context"
import { Out } from "./A"
import { canKeepIncidents } from "./IncidentLink"

/** What the tool last said, before the link: its status, severity and responders, or that it did not answer. */
const saidOf = (tool: string, read: ReadBack | undefined) => {
  if (read?.failing !== undefined) return `${tool} did not answer: ${read.failing} · `
  const said = read?.said
  const parts =
    said === undefined
      ? []
      : [said.status, ...(said.severity === undefined ? [] : [said.severity]), said.responders.join(", ")]
  return `In ${tool}: ${parts
    .filter((each) => each !== "")
    .map((each) => `${each} · `)
    .join("")}`
}

export const IncidentInTool = (props: {
  readonly incident: Incident
  /** What the tool last said of it, once it is raised and read back. */
  readonly read: ReadBack | undefined
  readonly changed: () => void
}) => {
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
          {saidOf(found().tool, props.read)}
          <Out href={found().link}>Open in {found().tool}</Out>
        </p>
      )}
    </Show>
  )
}
