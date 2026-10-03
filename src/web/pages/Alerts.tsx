/** @jsxImportSource solid-js */
/** Alerts: firing, pending and silenced together, filtered by state and service; what resolved today below. */
import { createSignal, For, Show } from "solid-js"
import type { Alert } from "../../shared/events"
import { useEstate, useSnapshot } from "../context"
import { clock, counted, duration, since } from "../format"
import { A, Out } from "../parts/A"
import { AlertCard } from "../parts/AlertCard"

type Filter = "all" | Alert["state"]

const filters: ReadonlyArray<{ readonly value: Filter; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "firing", label: "Firing" },
  { value: "pending", label: "Pending" },
  { value: "silenced", label: "Silenced" },
]

export const alertsSummary = (alerts: ReadonlyArray<Alert>): string => {
  const count = (state: Alert["state"]) => alerts.filter((alert) => alert.state === state).length
  if (alerts.length === 0) return "Nothing is firing, pending or silenced."
  return `${counted(count("firing"), "alert")} firing, ${count("pending")} pending, ${count("silenced")} silenced.`
}

export const Alerts = () => {
  const { me, now, actions } = useEstate()
  const snapshot = useSnapshot()
  const [filter, setFilter] = createSignal<Filter>("all")
  const [service, setService] = createSignal("")
  const [open, setOpen] = createSignal<string | undefined>(undefined)
  const alerts = () => snapshot.events.alerts?.alerts ?? []
  const canSilence = () => me.role === "operator" && snapshot.events.alerts?.silences === true
  const services = () =>
    [...new Set(alerts().flatMap((alert) => (alert.service === undefined ? [] : [alert.service])))].sort()
  const shown = () =>
    alerts().filter(
      (alert) => (filter() === "all" || alert.state === filter()) && (service() === "" || alert.service === service()),
    )
  const opened = () => alerts().find((alert) => alert.id === open())
  const resolved = () => snapshot.events.alerts?.resolved ?? []
  return (
    <main class="main">
      <div class="spread" style={{ "align-items": "flex-end" }}>
        <div class="stack">
          <h1 class="headline" style={{ "font-size": "38px" }}>
            Alerts
          </h1>
          <p class="lede">{alertsSummary(alerts())}</p>
        </div>
        <div class="choices" style={{ "align-items": "center" }}>
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
                  {each.label}{" "}
                  <span class="muted">
                    {each.value === "all"
                      ? alerts().length
                      : alerts().filter((alert) => alert.state === each.value).length}
                  </span>
                </button>
              )}
            </For>
          </fieldset>
          <label class="select-label">
            Service
            <select value={service()} onChange={(event) => setService(event.currentTarget.value)} class="select">
              <option value="">All services</option>
              <For each={services()}>{(name) => <option value={name}>{name}</option>}</For>
            </select>
          </label>
        </div>
      </div>
      <Show when={opened()}>
        {(alert) => (
          <div class="cards">
            <AlertCard alert={alert()} catalog={snapshot.events.catalog} canSilence={canSilence()} />
          </div>
        )}
      </Show>
      <section aria-label="Alerts" class="table-scroll panel">
        <table class="grid">
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">What</th>
              <th scope="col">Service</th>
              <th scope="col">Since</th>
              <th scope="col">Latest note</th>
              <th scope="col">
                <span class="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={shown()}>
              {(alert) => {
                const note = () => alert.notes[0]
                return (
                  <tr class={alert.state === "silenced" ? "greyed" : ""}>
                    <td>
                      <span class="cell-version">
                        <span
                          class={`dot ${alert.state === "firing" ? (alert.severity === "critical" ? "critical" : "attention") : "unknown"}`}
                        />
                        {alert.state}
                      </span>
                    </td>
                    <td>
                      <div style={{ "font-weight": 600 }}>{alert.summary ?? alert.name}</div>
                      <Show when={alert.impact}>
                        {(impact) => <div class="cell-note">Impact: {impact().text}</div>}
                      </Show>
                      <div class="cell-note mono">
                        {alert.name} · {alert.severity}
                      </div>
                      <Show when={alert.silence}>
                        {(silence) => (
                          <div class="cell-note">
                            silenced until {clock(silence().endsAt)} by {silence().by}: “{silence().reason}”
                          </div>
                        )}
                      </Show>
                    </td>
                    <td>
                      {alert.service === undefined ? (
                        <span class="muted">–</span>
                      ) : (
                        <A to={`/services/${encodeURIComponent(alert.service)}`}>{alert.service}</A>
                      )}
                    </td>
                    <td class="mono">{since(alert.startsAt, now())}</td>
                    <td>
                      <Show when={note()} fallback={<span class="muted">none</span>}>
                        {(latest) => (
                          <>
                            {latest().text}
                            <div class="cell-note">
                              {latest().by} · {clock(latest().at)}
                            </div>
                          </>
                        )}
                      </Show>
                    </td>
                    <td>
                      <div class="choices" style={{ "justify-content": "flex-end" }}>
                        <Show when={alert.runbook}>
                          {(runbook) => (
                            <Out href={runbook()} class="plain-button link-button">
                              Runbook
                            </Out>
                          )}
                        </Show>
                        {alert.state === "silenced" && canSilence() && alert.silence !== undefined ? (
                          <button
                            type="button"
                            class="plain-button"
                            onClick={() => void actions.unsilence(alert.silence?.id ?? "")}
                          >
                            Unsilence
                          </button>
                        ) : (
                          <button
                            type="button"
                            class="plain-button"
                            onClick={() => setOpen(open() === alert.id ? undefined : alert.id)}
                          >
                            {open() === alert.id ? "Close" : "Notes and silence"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              }}
            </For>
          </tbody>
        </table>
        <Show when={shown().length === 0}>
          <p class="muted" style={{ padding: "0 16px" }}>
            Nothing here for this filter.
          </p>
        </Show>
      </section>
      <section aria-labelledby="resolved" class="stack">
        <h2 id="resolved" class="section-title">
          Resolved today
        </h2>
        <Show when={resolved().length === 0}>
          <p class="muted" style={{ margin: 0 }}>
            Nothing has resolved today.
          </p>
        </Show>
        <For each={resolved()}>
          {(each) => (
            <div class="silenced-row">
              <span class="mono" style={{ color: "var(--ink-soft)" }}>
                {each.name}
              </span>
              <span>{each.service ?? ""}</span>
              <span>
                resolved at {clock(each.endsAt)} after {duration(Date.parse(each.endsAt) - Date.parse(each.startsAt))}
              </span>
            </div>
          )}
        </For>
      </section>
    </main>
  )
}
