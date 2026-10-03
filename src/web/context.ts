/** What every part of the page can reach: the store, the person, where we are, and the actions they may take. */
import { createContext, useContext } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { Me, ServiceState } from "../shared/events"
import type { ErrorGroups, LogBatch } from "../shared/log-events"
import type { Live, Snapshot } from "./live"
import type { Page } from "./route"

export interface Actions {
  readonly navigate: (path: string) => void
  readonly choose: (environment: string) => void
  readonly addNote: (alert: string, text: string) => Promise<boolean>
  /** Writes what an alert, by its name, means for users; empty text forgets it. */
  readonly setImpact: (alert: string, text: string) => Promise<boolean>
  readonly removeNote: (note: string) => Promise<boolean>
  readonly silence: (alert: string, minutes: number, reason: string) => Promise<boolean>
  readonly unsilence: (silence: string) => Promise<boolean>
  readonly debug: (service: string, minutes: number) => Promise<boolean>
  readonly undebug: (service: string) => Promise<boolean>
  readonly load: (service: string, range: Range) => Promise<ServiceState["load"] | undefined>
  /** A store's stats over a range, as a load with only stats. */
  readonly storeLoad: (store: string, range: Range) => Promise<ServiceState["load"] | undefined>
  /** A service's live lines; the returned function stops watching. */
  readonly watchLogs: (service: string, handlers: LogHandlers) => () => void
  /** A service's errors grouped, over a range or since a time: "none" where it has no logs to read. */
  readonly errors: (service: string, window: ErrorWindow) => Promise<ErrorGroups | "none" | undefined>
}

export interface LogHandlers {
  /** Where its lines come from, once the stream is open. */
  readonly from: (from: string) => void
  readonly batch: (batch: LogBatch) => void
  /** The stream was refused or there is nothing to read: no logs for this service here, or not for this person. */
  readonly missing: () => void
}

export type ErrorWindow = { readonly range: "1h" | "6h" | "24h" } | { readonly since: string }

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
  live.subscribe(() => setSnapshot(reconcile(held(live.snapshot()) as Snapshot, { key: "id", merge: true })))
  stores.set(live, snapshot)
  return snapshot
}
