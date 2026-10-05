/** Actions that record what they were asked, answering as the server would, for the pages' tests. */
import type { LogBatch } from "../shared/log-events"
import type { Actions, LogHandlers } from "./context"
import { series } from "./fixture"
import { groups, lines } from "./fixture-logs"

/** Two runs of the triage agent, as Langfuse would give them: one failed, one through. */
const runs = [
  {
    id: "r2",
    startedAt: "2026-10-03T11:58:00Z",
    failed: true,
    message: "tool search_orders timed out",
    seconds: 31,
    tokens: 12_400,
    cost: 0.041,
    model: "claude-sonnet",
    url: "https://langfuse.example/project/p/traces/r2",
  },
  {
    id: "r1",
    startedAt: "2026-10-03T11:55:00Z",
    failed: false,
    seconds: 9.5,
    tokens: 4_100,
    cost: 0.012,
    model: "claude-sonnet",
  },
]

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
      setImpact: record("setImpact"),
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
      runs: (agent) => {
        calls.push(["runs", agent])
        return Promise.resolve(agent === "triage" ? runs : agent === "broken" ? undefined : "none")
      },
      askAlert: (alert, _onChunk) => {
        calls.push(["askAlert", alert])
        return Promise.resolve({
          likelyCause: "A recent deploy raised latency.",
          evidence: [{ text: "storefront v2 deployed 26 min before it fired" }],
          nextSteps: ["Check the runbook", "Compare p99 before and after the deploy"],
          confidence: "medium" as const,
          tools: ["around_alert", "service"],
          model: "fake-model",
        })
      },
    },
    sendLines: (batch) => {
      for (const handlers of watching) handlers.batch(batch)
    },
  }
}

/** A store for production, and a way to send it an event. */
