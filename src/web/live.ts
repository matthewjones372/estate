/**
 * The page's one store: what the server last sent for the chosen environment, fed by an event stream and read with
 * `useSyncExternalStore`. Opening the stream is passed in, so a test feeds it by hand.
 */
import { Option, Schema } from "effect"
import { type EventName, type Events, events } from "../shared/events"
import { applyShifts } from "../shared/shifts"

export interface Snapshot {
  readonly environment: string
  readonly connection: "connecting" | "open" | "lost"
  readonly events: Partial<Events>
  readonly heardAt: number | undefined
}

export interface Handlers {
  readonly onOpen: () => void
  readonly onEvent: (name: EventName, data: string) => void
  /** The server is still there, with nothing new to say. */
  readonly onBeat: () => void
  readonly onLost: () => void
}

export type Open = (environment: string, handlers: Handlers) => () => void

const decoders = Object.fromEntries(
  Object.entries(events).map(([name, schema]) => [name, Schema.decodeUnknownOption(schema)]),
) as Readonly<Record<EventName, (input: unknown) => Option.Option<unknown>>>

const parse = (data: string): unknown => {
  const parsed = Option.liftThrowable(JSON.parse)(data)
  return Option.getOrUndefined(parsed)
}

/** A services event as the page should hold it: a partial one's services merged by name into those it has. */
const merged = (held: Events["services"] | undefined, sent: Events["services"]): Events["services"] => {
  if (sent.partial !== true || held === undefined) return sent
  const changed = new Map(sent.services.map((service) => [service.name, service]))
  const { partial: _, shifts = [], ...rest } = sent
  return {
    ...rest,
    services: held.services.map((service) => changed.get(service.name) ?? applyShifts(service, shifts)),
  }
}

export interface Live {
  readonly subscribe: (listener: () => void) => () => void
  readonly snapshot: () => Snapshot
  readonly choose: (environment: string) => void
}

export const createLive = (open: Open, environment: string, now: () => number = Date.now): Live => {
  let snapshot: Snapshot = { environment, connection: "connecting", events: {}, heardAt: undefined }
  const listeners = new Set<() => void>()
  const set = (next: Snapshot) => {
    snapshot = next
    for (const listener of listeners) listener()
  }
  const connect = (chosen: string) =>
    open(chosen, {
      onOpen: () => set({ ...snapshot, connection: "open" }),
      onLost: () => set({ ...snapshot, connection: "lost" }),
      onBeat: () => set({ ...snapshot, connection: "open", heardAt: now() }),
      onEvent: (name, data) => {
        const decoded = decoders[name](parse(data))
        if (Option.isSome(decoded)) {
          const value =
            name === "services" ? merged(snapshot.events.services, decoded.value as Events["services"]) : decoded.value
          set({
            ...snapshot,
            connection: "open",
            heardAt: now(),
            events: { ...snapshot.events, [name]: value } as Partial<Events>,
          })
        }
      },
    })
  let close = connect(environment)
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => snapshot,
    choose: (chosen) => {
      if (chosen === snapshot.environment) return
      close()
      set({ environment: chosen, connection: "connecting", events: {}, heardAt: undefined })
      close = connect(chosen)
    },
  }
}
