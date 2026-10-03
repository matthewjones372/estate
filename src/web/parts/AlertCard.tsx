/** An alert that needs someone: what fired against its threshold, its notes, Silence, and where to look. */
import { useState } from "react"
import type { Alert, CatalogEvent } from "../../shared/events"
import { shape } from "../chart"
import { useEstate } from "../context"
import { amount, clock, initials, since } from "../format"
import { A, Out } from "./A"
import { Icon } from "./icons"

const minutesUntilNine = (now: number): number => {
  const nine = new Date(now)
  nine.setDate(nine.getDate() + 1)
  nine.setHours(9, 0, 0, 0)
  return Math.round((nine.getTime() - now) / 60_000)
}

const spansFrom = (now: number) =>
  [
    { label: "1 hour", minutes: 60 },
    { label: "6 hours", minutes: 360 },
    { label: "1 day", minutes: 1440 },
    { label: "until 09:00 tomorrow", minutes: minutesUntilNine(now) },
  ] as const

const Chart = (props: { readonly alert: Alert }) => {
  const chart = props.alert.chart
  if (chart === undefined) return null
  const known = chart.points.filter((point): point is number => point !== null)
  const high = Math.max(chart.threshold * 1.25, ...known)
  const drawn = shape(chart.points, 400, 80, { pad: 6, low: 0, high })
  const now = known.at(-1)
  return (
    <div>
      <svg
        viewBox="0 0 400 80"
        preserveAspectRatio="none"
        role="img"
        style={{ width: "100%", height: 80, display: "block" }}
        aria-label={`${props.alert.name} over the last hour against its threshold ${amount(chart.threshold)}, now ${amount(now)}`}
      >
        {drawn.area !== "" && <polygon points={drawn.area} fill="#F5A524" fillOpacity="0.12" />}
        <line
          x1="0"
          y1={drawn.y(chart.threshold)}
          x2="400"
          y2={drawn.y(chart.threshold)}
          stroke="#F5A524"
          strokeWidth="1"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={drawn.line}
          fill="none"
          stroke="#F5B54A"
          strokeWidth="2"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="chart-axis mono">
        <span>1 h ago</span>
        <span>threshold {amount(chart.threshold)}</span>
        <span>now {amount(now)}</span>
      </div>
    </div>
  )
}

const Notes = (props: { readonly alert: Alert }) => {
  const { actions, me } = useEstate()
  const [draft, setDraft] = useState("")
  const notes = props.alert.notes
  const post = async () => {
    const text = draft.trim()
    if (text !== "" && (await actions.addNote(props.alert.id, text))) setDraft("")
  }
  return (
    <div className="alert-notes">
      <div className="spread">
        <span className="alert-label">Notes</span>
        <span className="alert-quiet">
          {notes.length === 0 ? "none yet" : `${notes.length} note${notes.length > 1 ? "s" : ""}`}
        </span>
      </div>
      {notes.map((note) => (
        <div key={note.id} className="note">
          <span className="note-avatar" aria-hidden="true">
            {initials(note.by)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="alert-quiet">
              <strong className="note-who">{note.by}</strong> · {clock(note.at)}
              {(note.by === me.name || me.role === "operator") && (
                <>
                  {" · "}
                  <button type="button" className="note-remove" onClick={() => void actions.removeNote(note.id)}>
                    Remove<span className="visually-hidden"> the note by {note.by}</span>
                  </button>
                </>
              )}
            </div>
            <div className="note-text">{note.text}</div>
          </div>
        </div>
      ))}
      <form
        className="note-form"
        onSubmit={(event) => {
          event.preventDefault()
          void post()
        }}
      >
        <label className="note-label">
          <span className="visually-hidden">Add a note to {props.alert.name}</span>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What you found, or that you are on it"
            className="amber-input"
          />
        </label>
        <button type="submit" className="amber-button">
          Add note
        </button>
      </form>
    </div>
  )
}

const Silencing = (props: { readonly alert: Alert; readonly close: () => void }) => {
  const { actions, now } = useEstate()
  const spans = spansFrom(now())
  const [minutes, setMinutes] = useState<number>(spans[0].minutes)
  const [reason, setReason] = useState("")
  const until = clock(new Date(now() + minutes * 60_000).toISOString())
  const silence = async () => {
    if (reason.trim() !== "" && (await actions.silence(props.alert.id, minutes, reason.trim()))) props.close()
  }
  return (
    <fieldset className="silencing">
      <legend style={{ fontSize: 13, fontWeight: 600, padding: 0 }}>Silence {props.alert.name} for</legend>
      <div className="choices">
        {spans.map((span) => (
          <button
            key={span.label}
            type="button"
            aria-pressed={minutes === span.minutes}
            className="choice"
            onClick={() => setMinutes(span.minutes)}
          >
            {span.label}
          </button>
        ))}
      </div>
      <label className="reason">
        Why (required, shown to everyone)
        <input
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. vacuum on the database, done by 15:00"
          className="amber-input"
        />
      </label>
      <p className="alert-quiet" style={{ margin: 0 }}>
        It stays on this page, greyed, and fires again if it is still true when the silence ends.
      </p>
      <div className="choices">
        <button type="button" className="primary-button" disabled={reason.trim() === ""} onClick={() => void silence()}>
          Silence until {until}
        </button>
        <button type="button" className="amber-button ghost" onClick={props.close}>
          Cancel
        </button>
      </div>
    </fieldset>
  )
}

export const AlertCard = (props: {
  readonly alert: Alert
  readonly catalog: CatalogEvent | undefined
  readonly canSilence: boolean
}) => {
  const { now } = useEstate()
  const [choosing, setChoosing] = useState(false)
  const { alert } = props
  const service = props.catalog?.services.find((each) => each.name === alert.service)
  const logs = service?.links.find((link) => link.name === "logs")
  const traces = service?.links.find((link) => link.name === "traces")
  return (
    <article className={`alert-card ${alert.severity === "critical" ? "critical" : ""}`}>
      <div className="alert-head">
        <span className="severity">{alert.severity}</span>
        <span className="mono alert-name">{alert.name}</span>
        <span className="alert-for">firing {since(alert.startsAt, now())}</span>
      </div>
      <div>
        <h3 className="alert-title">{alert.summary ?? alert.name}</h3>
        {alert.service !== undefined && <p className="alert-detail">{alert.service}</p>}
      </div>
      <Chart alert={alert} />
      <Notes alert={alert} />
      {choosing && <Silencing alert={alert} close={() => setChoosing(false)} />}
      <div className="choices">
        {alert.runbook !== undefined && (
          <Out href={alert.runbook} className="primary-button">
            Open the runbook
          </Out>
        )}
        {alert.service !== undefined && (
          <A to={`/services/${encodeURIComponent(alert.service)}`} className="amber-button ghost">
            {alert.service}
          </A>
        )}
        {logs !== undefined && (
          <Out href={logs.url} className="amber-button ghost">
            Logs
          </Out>
        )}
        {traces !== undefined && (
          <Out href={traces.url} className="amber-button ghost">
            Traces
          </Out>
        )}
        {props.canSilence && !choosing && (
          <button type="button" className="amber-button ghost push-right" onClick={() => setChoosing(true)}>
            <Icon name="silence" />
            Silence…
          </button>
        )}
      </div>
    </article>
  )
}
