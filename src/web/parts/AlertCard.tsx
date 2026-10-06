/** @jsxImportSource solid-js */
/** An alert that needs someone: what fired against its threshold, its notes, Silence, and where to look. */
import { createMemo, createSignal, For, on, Show } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { Alert, CatalogEvent } from "../../shared/events"
import { reading } from "../chart"
import { useEstate } from "../context"
import { amount, clock, initials, since } from "../format"
import { chatOf, teamOf } from "../teams"
import { A, Out } from "./A"
import { AroundLine } from "./Around"
import { History } from "./History"
import { Impact } from "./Impact"
import { Icon } from "./icons"
import { ErrorList } from "./Logs"
import { Plot } from "./Plot"
import { RaiseIncident } from "./RaiseIncident"

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

const hour = 3_600_000

const tenMinutesBefore = (iso: string) => new Date(Date.parse(iso) - 10 * 60_000).toISOString()

type AlertChart = NonNullable<Alert["chart"]>

const Chart = (props: { readonly name: string; readonly chart: AlertChart }) => {
  const { now: clockNow } = useEstate()
  const [mark, setMark] = createSignal<number | undefined>(undefined)
  const now = () => props.chart.points.filter((point): point is number => point !== null).at(-1)
  const end = createMemo(on(() => props.chart.points, clockNow))
  const read = () => reading(props.chart.points, end(), hour, mark())
  return (
    <div>
      <Plot
        label={`${props.name} over the last hour against its threshold ${amount(props.chart.threshold)}, now ${amount(now())}`}
        points={props.chart.points}
        end={end()}
        span={hour}
        width={400}
        height={80}
        pad={6}
        headroom={props.chart.threshold * 1.25}
        ink="#F5A524"
        fill={0.12}
        limit={{ value: props.chart.threshold, ink: "#F5A524" }}
        style={{ width: "100%", height: "80px", display: "block" }}
        keys
        mark={mark()}
        onMark={setMark}
      />
      <div class="chart-axis mono">
        <span>1 h ago</span>
        <span>threshold {amount(props.chart.threshold)}</span>
        <span aria-live="polite">
          {read() === undefined
            ? `now ${amount(now())}`
            : `${clock(new Date(read()?.at ?? 0).toISOString())} ${amount(read()?.value)}`}
        </span>
      </div>
    </div>
  )
}

const Notes = (props: { readonly alert: Alert }) => {
  const { actions, me } = useEstate()
  const [draft, setDraft] = createSignal("")
  const notes = () => props.alert.notes
  const post = () => {
    const text = draft().trim()
    if (text === "") return
    void actions.addNote(props.alert.id, text).then((added) => {
      if (added) setDraft("")
    })
  }
  return (
    <div class="alert-notes">
      <div class="spread">
        <span class="alert-label">Notes</span>
        <span class="alert-quiet">
          {notes().length === 0 ? "none yet" : `${notes().length} note${notes().length > 1 ? "s" : ""}`}
        </span>
      </div>
      <For each={notes()}>
        {(note) => (
          <div class="note">
            <span class="note-avatar" aria-hidden="true">
              {initials(note.by)}
            </span>
            <div style={{ "min-width": 0 }}>
              <div class="alert-quiet">
                <strong class="note-who">{note.by}</strong> · {clock(note.at)}
                <Show when={note.by === me.name || me.role === "operator"}>
                  {" · "}
                  <button type="button" class="note-remove" onClick={() => void actions.removeNote(note.id)}>
                    Remove<span class="visually-hidden"> the note by {note.by}</span>
                  </button>
                </Show>
              </div>
              <div class="note-text">{note.text}</div>
            </div>
          </div>
        )}
      </For>
      <form
        class="note-form"
        onSubmit={(event) => {
          event.preventDefault()
          post()
        }}
      >
        <label class="note-label">
          <span class="visually-hidden">Add a note to {props.alert.name}</span>
          <input
            type="text"
            value={draft()}
            onInput={(event) => setDraft(event.currentTarget.value)}
            placeholder="What you found, or that you are on it"
            class="amber-input"
          />
        </label>
        <button type="submit" class="amber-button">
          Add note
        </button>
      </form>
    </div>
  )
}

const Silencing = (props: { readonly alert: Alert; readonly close: () => void }) => {
  const { actions, now } = useEstate()
  const spans = spansFrom(now())
  const [minutes, setMinutes] = createSignal<number>(spans[0].minutes)
  const [reason, setReason] = createSignal("")
  const until = () => clock(new Date(now() + minutes() * 60_000).toISOString())
  const silence = () => {
    const why = reason().trim()
    if (why === "") return
    void actions.silence(props.alert.id, minutes(), why).then((done) => {
      if (done) props.close()
    })
  }
  return (
    <fieldset class="silencing">
      <legend style={{ "font-size": "13px", "font-weight": 600, padding: 0 }}>Silence {props.alert.name} for</legend>
      <div class="choices">
        <For each={spans}>
          {(span) => (
            <button
              type="button"
              aria-pressed={minutes() === span.minutes}
              class="choice"
              onClick={() => setMinutes(span.minutes)}
            >
              {span.label}
            </button>
          )}
        </For>
      </div>
      <label class="reason">
        Why (required, shown to everyone)
        <input
          type="text"
          value={reason()}
          onInput={(event) => setReason(event.currentTarget.value)}
          placeholder="e.g. vacuum on the database, done by 15:00"
          class="amber-input"
        />
      </label>
      <p class="alert-quiet" style={{ margin: 0 }}>
        It stays on this page, greyed, and fires again if it is still true when the silence ends.
      </p>
      <div class="choices">
        <button type="button" class="primary-button" disabled={reason().trim() === ""} onClick={silence}>
          Silence until {until()}
        </button>
        <button type="button" class="amber-button ghost" onClick={() => props.close()}>
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
  /** The level of its title: 3 among other cards under a section, 2 on the alert's own page. */
  readonly level?: 2 | 3
}) => {
  const { now } = useEstate()
  const [choosing, setChoosing] = createSignal(false)
  const [lines, setLines] = createSignal(false)
  const service = () => props.catalog?.services.find((each) => each.name === props.alert.service)
  const link = (name: string) => service()?.links.find((each) => each.name === name)
  const chat = () => chatOf(teamOf(props.catalog, service()?.owner))
  return (
    <article class={`alert-card ${props.alert.severity === "critical" ? "critical" : ""}`}>
      <div class="alert-head">
        <span class="severity">{props.alert.severity}</span>
        <A to={`/alerts/${encodeURIComponent(props.alert.id)}`} class="mono alert-name">
          {props.alert.name}
        </A>
        <span class="alert-for">firing {since(props.alert.startsAt, now())}</span>
      </div>
      <div>
        <Dynamic component={props.level === 2 ? "h2" : "h3"} class="alert-title">
          {props.alert.summary ?? props.alert.name}
        </Dynamic>
        <Show when={props.alert.service}>{(name) => <p class="alert-detail">{name()}</p>}</Show>
      </div>
      <Impact alert={props.alert} />
      <History alert={props.alert} />
      <AroundLine alert={props.alert} />
      <Show when={props.alert.chart}>{(chart) => <Chart name={props.alert.name} chart={chart()} />}</Show>
      <Notes alert={props.alert} />
      <Show when={choosing()}>
        <Silencing alert={props.alert} close={() => setChoosing(false)} />
      </Show>
      <Show when={lines() ? props.alert.service : undefined}>
        {(name) => (
          <div class="alert-lines">
            <span class="alert-label">Errors from ten minutes before it started</span>
            <ErrorList service={name()} window={{ since: tenMinutesBefore(props.alert.startsAt) }} most={3} />
          </div>
        )}
      </Show>
      <div class="choices">
        <Show when={props.alert.runbook}>
          {(runbook) => (
            <Out href={runbook()} class="primary-button">
              Open the runbook
            </Out>
          )}
        </Show>
        <RaiseIncident alert={props.alert} links={service()?.links} class="primary-button" />
        <Show when={chat()}>
          {(team) => (
            <Out href={team().url} class="amber-button ghost">
              {team().text}
            </Out>
          )}
        </Show>
        <Show when={props.alert.service}>
          {(name) => (
            <A to={`/services/${encodeURIComponent(name())}`} class="amber-button ghost">
              {name()}
            </A>
          )}
        </Show>
        <Show when={link("logs")}>
          {(logs) => (
            <Out href={logs().url} class="amber-button ghost">
              Logs
            </Out>
          )}
        </Show>
        <Show when={link("traces")}>
          {(traces) => (
            <Out href={traces().url} class="amber-button ghost">
              Traces
            </Out>
          )}
        </Show>
        <Show when={props.alert.service !== undefined}>
          <button type="button" class="amber-button ghost" aria-pressed={lines()} onClick={() => setLines(!lines())}>
            Lines from then
          </button>
        </Show>
        <Show when={props.canSilence && !choosing()}>
          <button type="button" class="amber-button ghost push-right" onClick={() => setChoosing(true)}>
            <Icon name="silence" />
            Silence…
          </button>
        </Show>
      </div>
    </article>
  )
}
