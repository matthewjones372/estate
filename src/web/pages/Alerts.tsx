/** Alerts: firing, pending and silenced together, filtered by state and service; what resolved today below. */
import { useState } from "react"
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
  const { events } = useSnapshot()
  const [filter, setFilter] = useState<Filter>("all")
  const [service, setService] = useState("")
  const [open, setOpen] = useState<string | undefined>(undefined)
  const alerts = events.alerts?.alerts ?? []
  const canSilence = me.role === "operator" && events.alerts?.silences === true
  const services = [...new Set(alerts.flatMap((alert) => (alert.service === undefined ? [] : [alert.service])))].sort()
  const shown = alerts.filter(
    (alert) => (filter === "all" || alert.state === filter) && (service === "" || alert.service === service),
  )
  const opened = alerts.find((alert) => alert.id === open)
  return (
    <main className="main">
      <div className="spread" style={{ alignItems: "flex-end" }}>
        <div className="stack">
          <h1 className="headline" style={{ fontSize: 38 }}>
            Alerts
          </h1>
          <p className="lede">{alertsSummary(alerts)}</p>
        </div>
        <div className="choices" style={{ alignItems: "center" }}>
          <fieldset className="choices bare">
            <legend className="visually-hidden">State</legend>
            {filters.map((each) => (
              <button
                key={each.value}
                type="button"
                aria-pressed={filter === each.value}
                className="filter"
                onClick={() => setFilter(each.value)}
              >
                {each.label}{" "}
                <span className="muted">
                  {each.value === "all" ? alerts.length : alerts.filter((alert) => alert.state === each.value).length}
                </span>
              </button>
            ))}
          </fieldset>
          <label className="select-label">
            Service
            <select value={service} onChange={(event) => setService(event.target.value)} className="select">
              <option value="">All services</option>
              {services.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {opened !== undefined && (
        <div className="cards">
          <AlertCard alert={opened} catalog={events.catalog} canSilence={canSilence} />
        </div>
      )}
      <section aria-label="Alerts" className="table-scroll panel">
        <table className="grid">
          <thead>
            <tr>
              <th scope="col">State</th>
              <th scope="col">What</th>
              <th scope="col">Service</th>
              <th scope="col">Since</th>
              <th scope="col">Latest note</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((alert) => {
              const note = alert.notes[0]
              return (
                <tr key={alert.id} className={alert.state === "silenced" ? "greyed" : ""}>
                  <td>
                    <span className="cell-version">
                      <span
                        className={`dot ${alert.state === "firing" ? (alert.severity === "critical" ? "critical" : "attention") : "unknown"}`}
                      />
                      {alert.state}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{alert.summary ?? alert.name}</div>
                    <div className="cell-note mono">
                      {alert.name} · {alert.severity}
                    </div>
                    {alert.silence !== undefined && (
                      <div className="cell-note">
                        silenced until {clock(alert.silence.endsAt)} by {alert.silence.by}: “{alert.silence.reason}”
                      </div>
                    )}
                  </td>
                  <td>
                    {alert.service === undefined ? (
                      <span className="muted">–</span>
                    ) : (
                      <A to={`/services/${encodeURIComponent(alert.service)}`}>{alert.service}</A>
                    )}
                  </td>
                  <td className="mono">{since(alert.startsAt, now())}</td>
                  <td>
                    {note === undefined ? (
                      <span className="muted">none</span>
                    ) : (
                      <>
                        {note.text}
                        <div className="cell-note">
                          {note.by} · {clock(note.at)}
                        </div>
                      </>
                    )}
                  </td>
                  <td>
                    <div className="choices" style={{ justifyContent: "flex-end" }}>
                      {alert.runbook !== undefined && (
                        <Out href={alert.runbook} className="plain-button link-button">
                          Runbook
                        </Out>
                      )}
                      {alert.state === "silenced" && canSilence && alert.silence !== undefined ? (
                        <button
                          type="button"
                          className="plain-button"
                          onClick={() => void actions.unsilence(alert.silence?.id ?? "")}
                        >
                          Unsilence
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="plain-button"
                          onClick={() => setOpen(open === alert.id ? undefined : alert.id)}
                        >
                          {open === alert.id ? "Close" : "Notes and silence"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="muted" style={{ padding: "0 16px" }}>
            Nothing here for this filter.
          </p>
        )}
      </section>
      <section aria-labelledby="resolved" className="stack">
        <h2 id="resolved" className="section-title">
          Resolved today
        </h2>
        {(events.alerts?.resolved ?? []).length === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            Nothing has resolved today.
          </p>
        )}
        {(events.alerts?.resolved ?? []).map((each) => (
          <div key={`${each.name}-${each.endsAt}`} className="silenced-row">
            <span className="mono" style={{ color: "var(--ink-soft)" }}>
              {each.name}
            </span>
            <span>{each.service ?? ""}</span>
            <span>
              resolved at {clock(each.endsAt)} after {duration(Date.parse(each.endsAt) - Date.parse(each.startsAt))}
            </span>
          </div>
        ))}
      </section>
    </main>
  )
}
