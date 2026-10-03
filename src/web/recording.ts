/** Actions that record what they were asked, answering as the server would, for the pages' tests. */
import type { LogBatch } from "../shared/log-events"
import type { Actions, LogHandlers } from "./context"
import { series } from "./fixture"
import { groups, lines } from "./fixture-logs"

export interface Recorded {
  readonly calls: Array<readonly [string, ...ReadonlyArray<unknown>]>
  readonly actions: Actions
  /** Sends lines to whoever is watching a service's logs. */
  readonly sendLines: (batch: LogBatch) => void
}

export const recording = (): Recorded => {
  const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = []
  const watching = new Set<LogHandlers>()
  const record =
    (name: string) =>
    (...args: ReadonlyArray<unknown>) => {
      calls.push([name, ...args])
      return Promise.resolve(true)
    }
  return {
    calls,
    actions: {
      navigate: (path) => {
        calls.push(["navigate", path])
      },
      choose: (environment) => {
        calls.push(["choose", environment])
      },
      addNote: record("addNote"),
      removeNote: record("removeNote"),
      silence: record("silence"),
      unsilence: record("unsilence"),
      debug: record("debug"),
      undebug: record("undebug"),
      load: (service, range) => {
        calls.push(["load", service, range])
        return Promise.resolve({ requests: series([1, 2]) })
      },
      storeLoad: (store, range) => {
        calls.push(["storeLoad", store, range])
        return Promise.resolve({ stats: [{ title: "Connections used", unit: "%", series: series([40, 45]) }] })
      },
      watchLogs: (service, handlers) => {
        calls.push(["watchLogs", service])
        if (service !== "storefront") {
          handlers.missing()
          return () => undefined
        }
        watching.add(handlers)
        handlers.from("Loki")
        handlers.batch(lines)
        return () => {
          calls.push(["unwatchLogs", service])
          watching.delete(handlers)
        }
      },
      errors: (service, window) => {
        calls.push(["errors", service, window])
        return Promise.resolve(service === "storefront" ? groups : "none")
      },
    },
    sendLines: (batch) => {
      for (const handlers of watching) handlers.batch(batch)
    },
  }
}

/** A store for production, and a way to send it an event. */
