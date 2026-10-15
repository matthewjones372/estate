/** @jsxImportSource solid-js */
/**
 * The services and stores an incident is about, its firings' and any an operator added, and the window its record
 * covers. An operator adds one while it is open, by its name in the catalog.
 */
import { createSignal, For, Show } from "solid-js"
import type { IncidentRecord } from "../../shared/incidents"
import { useEstate } from "../context"
import { day } from "../format"
import { canKeepIncidents } from "./IncidentLink"

export const IncidentServices = (props: {
  readonly record: IncidentRecord
  /** Reads the incident again once a service is added. */
  readonly changed: () => void
}) => {
  const { actions, me } = useEstate()
  const [draft, setDraft] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const incident = () => props.record.incident
  const add = () => {
    const service = draft().trim()
    if (service === "" || busy()) return
    setBusy(true)
    setRefused(undefined)
    void actions.addIncidentService(incident().id, service).then((result) => {
      setBusy(false)
      if (typeof result === "string") setRefused(result)
      else {
        setDraft("")
        props.changed()
      }
    })
  }
  return (
    <section aria-labelledby="incident-services" class="panel section-box stack incident-services" aria-busy={busy()}>
      <h2 id="incident-services" class="section-title">
        Services
      </h2>
      <Show when={(props.record.services ?? []).length > 0} fallback={<p>None of its firings names a service.</p>}>
        <ul>
          <For each={props.record.services}>{(service) => <li>{service}</li>}</For>
        </ul>
      </Show>
      <Show when={props.record.window}>
        {(window) => (
          <p class="muted">
            From {day(window().from)} to {incident().closedAt === undefined ? "now" : day(window().to)}
          </p>
        )}
      </Show>
      <Show when={canKeepIncidents(me) && incident().closedAt === undefined}>
        <form
          class="note-form"
          onSubmit={(event) => {
            event.preventDefault()
            add()
          }}
        >
          <label class="note-label">
            <span class="visually-hidden">Add a service to {incident().title}</span>
            <input
              type="text"
              value={draft()}
              onInput={(event) => setDraft(event.currentTarget.value)}
              placeholder="A service or store from the catalog"
              class="amber-input"
            />
          </label>
          <button type="submit" class="amber-button" disabled={busy()} aria-busy={busy()}>
            Add service
          </button>
        </form>
      </Show>
      <Show when={refused()}>
        {(why) => (
          <p class="alert-detail" role="alert">
            {why()}
          </p>
        )}
      </Show>
    </section>
  )
}
