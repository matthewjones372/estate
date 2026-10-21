/** What every part of the page can reach: the store, the person, where we are, and the actions they may take. */
import { createContext, useContext } from "solid-js"
import { createStore, reconcile, unwrap } from "solid-js/store"
import type { AgentRun } from "../shared/agents"
import type { AroundAlert } from "../shared/around"
import type { AskAnswer } from "../shared/ask"
import type { Events, Me, ServiceState } from "../shared/events"
import type { EvidenceSet } from "../shared/evidence"
import type { PastFiring } from "../shared/firing"
import type { Incident, IncidentRecord } from "../shared/incidents"
import type { Included } from "../shared/included"
import type { KafkaCluster } from "../shared/kafka-cluster"
import type { ErrorGroups, LogBatch } from "../shared/log-events"
import type { SummaryAnswer } from "../shared/summary"
import type { FiringEvent } from "../shared/timeline"
import type { TraceView } from "../shared/trace-view"
import type { JourneySample } from "../shared/traces"
import type { Live, Snapshot } from "./live"
import type { ErrorRange, Page } from "./route"
import type { Exported } from "./timeline-path"

export interface Actions {
  readonly navigate: (path: string) => void
  readonly choose: (environment: string) => void
  /** Writes a note on an alert; `from` says it is an Ask AI answer kept, for the firing's timeline. */
  readonly addNote: (alert: string, text: string, from?: "ask-ai") => Promise<boolean>
  /** Writes what an alert, by its name, means for users; empty text forgets it. */
  readonly setImpact: (alert: string, text: string) => Promise<boolean>
  readonly removeNote: (note: string) => Promise<boolean>
  readonly silence: (alert: string, minutes: number, reason: string) => Promise<boolean>
  readonly unsilence: (silence: string) => Promise<boolean>
  readonly debug: (service: string, minutes: number) => Promise<boolean>
  readonly undebug: (service: string) => Promise<boolean>
  readonly load: (service: string, range: Range) => Promise<ServiceState["load"] | undefined>
  /** A service's load over a window in the past, `from` and `to` times. */
  readonly loadBetween: (service: string, from: string, to: string) => Promise<ServiceState["load"] | undefined>
  /** A store's stats over a range, as a load with only stats. */
  readonly storeLoad: (store: string, range: Range) => Promise<ServiceState["load"] | undefined>
  /** A Kafka store's cluster now (spec 0057), or why it could not be read. */
  readonly storeCluster: (store: string) => Promise<KafkaCluster | string>
  /** A service's live lines; the returned function stops watching. */
  readonly watchLogs: (service: string, handlers: LogHandlers) => () => void
  /** An agent's recent runs: "none" where it has no runs to read, undefined where they could not be read. */
  readonly runs: (agent: string) => Promise<ReadonlyArray<AgentRun> | "none" | undefined>
  /** A journey over a sample of its recent traces: "none" where it has none to read, undefined where they failed. */
  readonly journey: (journey: string) => Promise<JourneySample | "none" | undefined>
  /** One trace as lanes and rows, measured as the journey where one is named: "none" where it is not found. */
  readonly trace: (id: string, journey?: string) => Promise<TraceView | "none" | undefined>
  /** A service's errors grouped, over a range or since a time: "none" where it has no logs to read. */
  readonly errors: (service: string, window: ErrorWindow) => Promise<ErrorGroups | "none" | undefined>
  /**
   * Ask AI about an alert: streams text chunks, then returns the structured answer, an error message, or undefined
   * when Ask AI is not configured or the request failed.
   */
  /** One past firing of an alert, or its latest without `at`: "none" where it is not kept, undefined on failure. */
  readonly firing: (alert: string, at?: string) => Promise<PastFiring | "none" | undefined>
  /** A firing's events, oldest first: undefined where they could not be read. */
  readonly events: (alert: string, startsAt: string) => Promise<ReadonlyArray<FiringEvent> | undefined>
  /** An alert's brief, *Around this alert*: undefined where it could not be gathered. */
  readonly around: (alert: string) => Promise<AroundAlert | undefined>
  /** Tells an alert's team on Slack: the thread's link, or why it could not. */
  readonly tell: (alert: string) => Promise<{ readonly url: string } | string>
  /** Ask AI about an alert: its answer, or why there is none; `signal` stops the ask when the page is left. */
  readonly askAlert: (alert: string, signal: AbortSignal) => Promise<AskAnswer | string>
  /** The incidents open now, newest first: undefined where they could not be read. */
  readonly incidents: () => Promise<ReadonlyArray<Incident> | undefined>
  /** Every incident kept, open and closed, newest first: undefined where they could not be read. */
  readonly allIncidents: () => Promise<ReadonlyArray<Incident> | undefined>
  /** Keeps what was found in an open incident (spec 0051): the set it was kept as, or why not. */
  readonly include: (incident: string, what: Included) => Promise<EvidenceSet | string>
  /** Removes what was included, as an event; true, or why not. */
  readonly removeIncluded: (incident: string, set: string) => Promise<true | string>
  /** An incident and its firings' events: "none" where there is no such incident, undefined on failure. */
  readonly incident: (id: string) => Promise<IncidentRecord | "none" | undefined>
  /** Each write answers with the incident as it now is, or why it could not. */
  readonly openIncident: (title: string, alert: string) => Promise<Incident | string>
  /** Links the firing of `alert`, in `environment` or the page's, into the incident. */
  readonly linkIncident: (id: string, alert: string, environment?: string) => Promise<Incident | string>
  /** Takes out the firing of `alert` in `environment` that started `startsAt`, of the several it may have had. */
  readonly unlinkIncident: (
    id: string,
    environment: string,
    alert: string,
    startsAt: string,
  ) => Promise<Incident | string>
  readonly closeIncident: (id: string, how: string) => Promise<Incident | string>
  /** A note on the incident; `from: "summary"` where it keeps a summary, which then heads the export. */
  readonly addIncidentNote: (id: string, text: string, from?: "summary") => Promise<Incident | string>
  /** Summarise an incident (spec 0051): the account, or why there is none. */
  readonly summarise: (id: string) => Promise<SummaryAnswer | string>
  readonly removeIncidentNote: (id: string, note: string) => Promise<Incident | string>
  /** *Add what happened*: a line kept at the time it happened, now without one; true once kept, or why not. */
  readonly addIncidentHappened: (id: string, text: string, at?: string) => Promise<true | string>
  /** *Keep evidence now*: its charts kept as a new set; true once kept, or why not. */
  readonly keepIncidentEvidence: (id: string) => Promise<true | string>
  /** *Add a service*: a service or store the incident is about beyond its firings'. */
  readonly addIncidentService: (id: string, service: string) => Promise<Incident | string>
  /** *Not this*: the firing of `alert`, in `environment` or the page's, is not part of the incident. */
  readonly dismissIncident: (id: string, alert: string, environment?: string) => Promise<Incident | string>
  /** Raises the incident in the incident tool, or answers with its link there if it was raised already. */
  readonly raiseIncident: (id: string) => Promise<Incident | string>
  /** A firing's or an incident's timeline as Markdown, to copy: its text, or why it could not be read. */
  readonly timelineMarkdown: (of: Exported) => Promise<{ readonly text: string } | string>
}

export interface LogHandlers {
  /** Where its lines come from, once the stream is open. */
  readonly from: (from: string) => void
  readonly batch: (batch: LogBatch) => void
  /** The stream was refused or there is nothing to read: no logs for this service here, or not for this person. */
  readonly missing: () => void
}

export type ErrorWindow = { readonly range: ErrorRange } | { readonly since: string; readonly until?: string }

export type Range = "1h" | "6h" | "24h" | "7d"

export interface Estate {
  readonly live: Live
  readonly me: Me
  /** Where we are; it changes as a person moves about, without the page reloading. */
  readonly page: () => Page
  readonly actions: Actions
  readonly now: () => number
}

export const EstateContext = createContext<Estate | undefined>(undefined)

export const useEstate = (): Estate => {
  const estate = useContext(EstateContext)
  if (estate === undefined) throw new Error("useEstate outside EstateContext")
  return estate
}

const stores = new WeakMap<Live, Snapshot>()

/**
 * A series the store holds whole: made from `whole` rather than a plain object, so the store does not track it point
 * by point, and a part that reads it is told when it is replaced. Sixty points in each of a lane's series, tracked one
 * by one, were most of a page's memory at a thousand services.
 */
const whole = {}
const wholes = new WeakMap<object, object>()

/** What the server sent, copied for the store to hold: each series in it held whole, and the same one if unchanged. */
const held = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(held)
  if (value === null || typeof value !== "object") return value
  if (Array.isArray((value as { readonly points?: unknown }).points)) {
    const kept = wholes.get(value) ?? Object.assign(Object.create(whole), value)
    wholes.set(value, kept)
    return kept
  }
  return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, held(each)]))
}

/**
 * What the server last sent, as a store: each event is reconciled into it, so a part that reads one field updates
 * when that field changes, and an alert or a service keeps its place, and its part's state, across events. One store
 * per page, living as long as the page does.
 */
export const useSnapshot = (): Snapshot => {
  const { live } = useEstate()
  const kept = stores.get(live)
  if (kept !== undefined) return kept
  const [snapshot, setSnapshot] = createStore<Snapshot>(held(live.snapshot()) as Snapshot)
  // Only what changed is copied and reconciled: a beat touches two fields, an event only itself.
  live.subscribe((change) => {
    const now = live.snapshot()
    switch (change.kind) {
      case "heard":
        setSnapshot({ connection: now.connection, heardAt: now.heardAt })
        return
      case "event": {
        // The other events are the store's own, unchanged, so reconciling passes over them at once.
        const events = { ...unwrap(snapshot.events), [change.name]: held(now.events[change.name]) } as Partial<Events>
        const next = { ...unwrap(snapshot), connection: now.connection, heardAt: now.heardAt, events }
        setSnapshot(reconcile(next, { key: "id", merge: true }))
        return
      }
      case "all":
        setSnapshot(reconcile(held(now) as Snapshot, { key: "id", merge: true }))
        return
    }
  })
  stores.set(live, snapshot)
  return snapshot
}
