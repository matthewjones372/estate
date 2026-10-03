/**
 * The page's one store: what the server last sent for the chosen environment, fed by an event stream and read with
 * `useSyncExternalStore`. Opening the stream is passed in, so a test feeds it by hand.
 */
import { Option, Schema } from "effect"
import { type EventName, type Events, events } from "../shared/events"

export interface Snapshot {
  readonly environment: string
  readonly connection: "connecting" | "open" | "lost"
  readonly events: Partial<Events>
  readonly heardAt: number | undefined
}

export interface Handlers {
  readonly onOpen: () => void
  readonly onEvent: (name: EventName, data: string) => void
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
      onEvent: (name, data) => {
        const decoded = decoders[name](parse(data))
        if (Option.isSome(decoded)) {
          set({
            ...snapshot,
            connection: "open",
            heardAt: now(),
            events: { ...snapshot.events, [name]: decoded.value } as Partial<Events>,
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
