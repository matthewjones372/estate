/** @jsxImportSource solid-js */
/** Every incident kept, open ones first and then closed, newest first, each opening its own page. */
import { createSignal, For, onMount, Show } from "solid-js"
import type { Incident } from "../../shared/incidents"
import { useEstate } from "../context"
import { counted, day, duration, since } from "../format"
import { A } from "../parts/A"

type Filter = "all" | "open" | "closed"

const isOpen = (incident: Incident) => incident.closedAt === undefined

const stateOf = (incident: Incident, now: number) =>
  incident.closedAt === undefined
    ? `open ${since(incident.openedAt, now)}`
    : `closed after ${duration(Date.parse(incident.closedAt) - Date.parse(incident.openedAt))}${incident.ended === undefined ? "" : `: ${incident.ended}`}`

const firingsOf = (incident: Incident) => {
  if (incident.firings.length === 0) return counted(0, "firing")
  const environments = [...new Set(incident.firings.map((each) => each.environment))].sort()
  return `${counted(incident.firings.length, "firing")} · ${environments.join(", ")}`
}

/** Open ones first, since they are what someone is looking for now; within each, newest first. */
const ordered = (incidents: ReadonlyArray<Incident>) =>
  incidents.toSorted((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || b.openedAt.localeCompare(a.openedAt))

export const Incidents = () => {
  const { now, actions } = useEstate()
  const [incidents, setIncidents] = createSignal<ReadonlyArray<Incident> | "reading" | undefined>("reading")
  const [filter, setFilter] = createSignal<Filter>("all")
  onMount(() => {
    void actions.allIncidents().then(setIncidents)
  })
  const read = () => {
    const found = incidents()
    return found === "reading" || found === undefined ? [] : found
  }
  const count = (which: Filter) =>
    read().filter((each) => which === "all" || isOpen(each) === (which === "open")).length
  const shown = () => ordered(read().filter((each) => filter() === "all" || isOpen(each) === (filter() === "open")))
  const filters: ReadonlyArray<{ readonly value: Filter; readonly label: string }> = [
    { value: "all", label: "All" },
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
  ]
  return (
    <main class="main">
      <div class="spread" style={{ "align-items": "flex-end" }}>
        <div class="stack">
          <h1 class="headline" style={{ "font-size": "38px" }}>
            Incidents
          </h1>
          <Show when={read().length > 0}>
            <p class="lede">
              {count("open")} open, {count("closed")} closed.
            </p>
          </Show>
        </div>
        <fieldset class="choices bare">
          <legend class="visually-hidden">State</legend>
          <For each={filters}>
            {(each) => (
              <button
                type="button"
                aria-pressed={filter() === each.value}
                class="filter"
                onClick={() => setFilter(each.value)}
              >
                {each.label} <span class="muted">{count(each.value)}</span>
              </button>
            )}
          </For>
        </fieldset>
      </div>
      <Show
        when={read().length > 0}
        fallback={
          <Show when={incidents() !== "reading"}>
            <p class="incidents-empty muted">
              {incidents() === undefined
                ? "Incidents could not be read."
                : "No incidents yet. An operator opens one from a firing alert's card with Link to incident."}
            </p>
          </Show>
        }
      >
        <section aria-label="Incidents" class="incidents table-scroll panel" tabindex="0">
          <table class="grid">
            <thead>
              <tr>
                <th scope="col">Incident</th>
                <th scope="col">State</th>
                <th scope="col">Firings</th>
                <th scope="col">Opened</th>
              </tr>
            </thead>
            <tbody>
              <For each={shown()}>
                {(incident) => {
                  const path = `/incidents/${encodeURIComponent(incident.id)}`
                  // The whole row opens the incident, for a pointer; the title is the link for a keyboard and a reader.
                  const openRow = (event: MouseEvent) => {
                    const target = event.target
                    if (target instanceof Element && target.closest("a, button")) return
                    actions.navigate(path)
                  }
                  return (
                    <tr class={`row-link ${isOpen(incident) ? "" : "greyed"}`} onClick={openRow}>
                      <td>
                        <A to={path} class="row-title">
                          {incident.title}
                        </A>
                      </td>
                      <td>{stateOf(incident, now())}</td>
                      <td>{firingsOf(incident)}</td>
                      <td>
                        {incident.openedBy}, {day(incident.openedAt)}
                      </td>
                    </tr>
                  )
                }}
              </For>
            </tbody>
          </table>
        </section>
      </Show>
    </main>
  )
}
