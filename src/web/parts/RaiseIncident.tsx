/** @jsxImportSource solid-js */
/**
 * Raise incident. Where Estate has an incident tool (spec 0043), an operator raises the card's incident in it, opening
 * one titled with the alert's summary first if the card is in none; once raised, the card opens it there. Elsewhere,
 * the catalog's link out to the tool's own form, hidden when the catalog has none.
 */
import { createSignal, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { useEstate } from "../context"
import { fillIncident, incidentOf, type NamedLink } from "../incident"
import { Out } from "./A"
import { canKeepIncidents } from "./IncidentLink"

const LinkOut = (props: {
  readonly alert: Pick<Alert, "name" | "summary">
  readonly links: ReadonlyArray<NamedLink> | undefined
  readonly class: string
}) => (
  <Show when={incidentOf(props.links)}>
    {(found) => (
      <Out
        href={fillIncident(found().url, { alert: props.alert.name, summary: props.alert.summary ?? props.alert.name })}
        class={props.class}
      >
        Raise incident
      </Out>
    )}
  </Show>
)

export const RaiseIncident = (props: {
  readonly alert: Pick<Alert, "id" | "name" | "summary" | "incident">
  readonly links: ReadonlyArray<NamedLink> | undefined
  readonly class?: string
}) => {
  const { me, actions } = useEstate()
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const open = () => (props.alert.incident?.closed === false ? props.alert.incident : undefined)
  const raisable = () => (canKeepIncidents(me) ? me.incidentTool : undefined)
  const raise = () => {
    if (busy()) return
    setBusy(true)
    setRefused(undefined)
    const current = open()
    const incident =
      current === undefined
        ? actions.openIncident(props.alert.summary ?? props.alert.name, props.alert.id)
        : Promise.resolve(current)
    void incident
      .then((found) => (typeof found === "string" ? found : actions.raiseIncident(found.id)))
      .then((result) => {
        setBusy(false)
        if (typeof result === "string") setRefused(result)
      })
  }
  const style = () => props.class ?? "amber-button ghost"
  return (
    <Show
      when={me.incidentTool === undefined ? undefined : open()?.link}
      fallback={
        <Show when={raisable()} fallback={<LinkOut alert={props.alert} links={props.links} class={style()} />}>
          {(tool) => (
            <span class="raise-incident">
              <button type="button" class={style()} disabled={busy()} aria-busy={busy()} onClick={raise}>
                {busy() ? "Raising…" : `Raise in ${tool()}`}
              </button>
              <Show when={refused()}>
                {(why) => (
                  <span class="alert-quiet" role="alert">
                    {why()}
                  </span>
                )}
              </Show>
            </span>
          )}
        </Show>
      }
    >
      {(link) => (
        <Out href={link()} class={style()}>
          Open in {me.incidentTool}
        </Out>
      )}
    </Show>
  )
}
