/** @jsxImportSource solid-js */
/**
 * An incident's own page: who opened it and when, how long it has been open or how it ended, its firings, its notes,
 * and every event of its firings merged in order, each saying which alert it was on, or that it was on the incident.
 * Incidents span environments, so it is read whole, whichever environment the page is in.
 */
import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from "solid-js"
import type { Incident, IncidentEvent, IncidentRecord } from "../../shared/incidents"
import { longestNote } from "../../shared/note"
import { onIncident } from "../../shared/timeline"
import { useEstate } from "../context"
import { day, duration, since } from "../format"
import { A } from "../parts/A"
import { IncidentFirings } from "../parts/IncidentFirings"
import { IncidentInTool } from "../parts/IncidentInTool"
import { canKeepIncidents } from "../parts/IncidentLink"
import { IncidentMayBelong } from "../parts/IncidentMayBelong"
import { IncidentNotes } from "../parts/IncidentNotes"
import { TimelineExport } from "../parts/TimelineExport"
import { TimelineRow } from "../parts/TimelineRow"

const lede = (incident: Incident, now: number) => {
  const opened = `opened by ${incident.openedBy}, ${day(incident.openedAt)}`
  const { closedAt } = incident
  if (closedAt === undefined) return `open ${since(incident.openedAt, now)} · ${opened}`
  const lasted = duration(Date.parse(closedAt) - Date.parse(incident.openedAt))
  return `closed by ${incident.closedBy ?? "someone"}, ${day(closedAt)}, after ${lasted}: ${incident.ended ?? ""} · ${opened}`
}

/** The alert an event was on, by the name its firing was linked with. */
const alertOf = (incident: Incident, event: IncidentEvent) =>
  incident.firings.find((each) => each.environment === event.environment && each.alert === event.alert)?.name ??
  event.alert

const Closing = (props: { readonly incident: Incident; readonly done: () => void }) => {
  const { actions } = useEstate()
  const [open, setOpen] = createSignal(false)
  const [how, setHow] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [refused, setRefused] = createSignal<string | undefined>(undefined)
  const close = () => {
    const ended = how().trim()
    if (ended === "" || busy()) return
    setBusy(true)
    setRefused(undefined)
    void actions.closeIncident(props.incident.id, ended).then((result) => {
      setBusy(false)
      if (typeof result === "string") setRefused(result)
      else {
        setOpen(false)
        props.done()
      }
    })
  }
  return (
    <Show
      when={open()}
      fallback={
        <div class="choices">
          <button type="button" class="amber-button ghost" onClick={() => setOpen(true)}>
            Close incident…
          </button>
        </div>
      }
    >
      <fieldset class="silencing incident-close" aria-busy={busy()}>
        <legend style={{ "font-size": "13px", "font-weight": 600, padding: 0 }}>Close {props.incident.title}</legend>
        <label class="reason">
          How it ended (required, kept on its record)
          <input
            // The button that opened this is gone, so the focus comes here rather than to the page.
            ref={(box) => onMount(() => box.focus())}
            type="text"
            value={how()}
            maxLength={longestNote}
            onInput={(event) => setHow(event.currentTarget.value)}
            placeholder="e.g. registry restarted, adoptions recovering"
            class="amber-input"
          />
        </label>
        <div class="choices">
          <button
            type="button"
            class="primary-button"
            disabled={how().trim() === "" || busy()}
            aria-busy={busy()}
            onClick={close}
          >
            <Show when={busy()} fallback="Close incident">
              <span class="ask-spinner" aria-hidden="true" />
              Closing…
            </Show>
          </button>
          <button type="button" class="amber-button ghost" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
        <Show when={refused()}>
          {(why) => (
            <p class="alert-detail" role="alert">
              {why()}
            </p>
          )}
        </Show>
      </fieldset>
    </Show>
  )
}

const Record = (props: { readonly record: IncidentRecord; readonly changed: () => void }) => {
  const { me, now } = useEstate()
  const incident = () => props.record.incident
  return (
    <main class="main">
      <nav aria-label="Breadcrumb" class="muted crumbs">
        <A to="/">Overview</A> / <A to="/alerts">Alerts</A> / {incident().title}
      </nav>
      <section aria-labelledby="incident-title" class="stack">
        <h1 id="incident-title" class="headline" style={{ "font-size": "32px" }}>
          {incident().title}
        </h1>
        <p class="lede">{lede(incident(), now())}</p>
        <IncidentInTool incident={incident()} read={props.record.inTool} changed={props.changed} />
        <Show when={canKeepIncidents(me) && incident().closedAt === undefined}>
          <Closing incident={incident()} done={props.changed} />
        </Show>
      </section>
      <IncidentFirings record={props.record} changed={props.changed} />
      <IncidentMayBelong record={props.record} changed={props.changed} />
      <IncidentNotes incident={incident()} changed={props.changed} />
      <section aria-labelledby="incident-timeline" class="panel section-box stack">
        <div class="section-head">
          <h2 id="incident-timeline" class="section-title">
            Timeline
          </h2>
          <TimelineExport of={{ incident: incident().id }} />
        </div>
        <Show
          when={props.record.events.length > 0}
          fallback={
            <p class="muted" style={{ margin: 0 }}>
              Nothing is kept for its firings yet.
            </p>
          }
        >
          <ol class="timeline">
            <For each={props.record.events}>
              {(event) => (
                <TimelineRow event={event} on={onIncident(event) ? "(incident)" : alertOf(incident(), event)} />
              )}
            </For>
          </ol>
        </Show>
      </section>
    </main>
  )
}

/** How often, at most, a raised incident's page reads again what the tool says of it. */
const readAgain = 30_000

export const IncidentPage = (props: { readonly id: string }) => {
  const { actions } = useEstate()
  const [read, setRead] = createSignal<IncidentRecord | "none" | "loading" | undefined>("loading")
  // Bumped after a change here, so the record and its events are read again as the server now has them.
  const [changes, setChanges] = createSignal(0)
  createEffect(
    on([() => props.id, changes], ([id]) => {
      let current = true
      void actions.incident(id).then((found) => {
        if (current) setRead(found)
      })
      onCleanup(() => {
        current = false
      })
    }),
  )
  const found = () => {
    const value = read()
    return typeof value === "object" ? value : undefined
  }
  // The tool's word on a raised incident changes outside Estate, so it is read again as the stream beats, at most
  // every half minute, while the incident is open.
  const { live, now } = useEstate()
  let readAt = now()
  onCleanup(
    live.subscribe(() => {
      const incident = found()?.incident
      if (incident?.raised === undefined || incident.closedAt !== undefined || now() - readAt < readAgain) return
      readAt = now()
      setChanges(changes() + 1)
    }),
  )
  return (
    <Show
      when={found()}
      fallback={
        <main class="state-page">
          <p class="muted">
            {read() === "loading"
              ? "Reading the incident…"
              : read() === "none"
                ? `There is no incident ${props.id} here.`
                : "The incident could not be read."}
          </p>
          <A to="/alerts">All alerts, and what resolved today</A>
        </main>
      }
    >
      {(record) => <Record record={record()} changed={() => setChanges(changes() + 1)} />}
    </Show>
  )
}
