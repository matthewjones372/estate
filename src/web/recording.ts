/** Actions that record what they were asked, answering as the server would, for the pages' tests. */
import type { AroundAlert } from "../shared/around"
import type { PastFiring } from "../shared/firing"
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

/** The brief of the fixture's OrdersSlow, as the server would gather it. */
export const brief: AroundAlert = {
  alert: "a1",
  name: "OrdersSlow",
  startsAt: "2026-10-03T11:46:00Z",
  subject: "storefront",
  changed: [
    { at: "2026-10-03T11:44:00Z", service: "storefront", kind: "deploy", text: "main-88-04bc441 deployed" },
    { at: "2026-10-03T11:50:00Z", service: "orders", kind: "build", text: "build passed: Retry", url: "https://ci/9" },
  ],
  depends: [
    {
      name: "orders-db",
      kind: "store",
      side: "calls",
      health: "attention",
      reasons: ["connections are high"],
      readings: [{ title: "Connections used", now: 92, unit: "%" }],
    },
  ],
  errors: groups,
  before: [],
  runbook: { url: "https://runbooks.example/orders-slow", text: "If p99 is high after a deploy, roll back." },
}

/** The fixture's OrdersSlow as it last fired, and once before Estate kept what an alert said. */
const firings: ReadonlyArray<PastFiring> = [
  {
    environment: "production",
    alert: "a1",
    name: "OrdersSlow",
    service: "storefront",
    severity: "critical",
    summary: "Orders are slow",
    runbook: "https://runbooks.example/orders-slow",
    startsAt: "2026-10-02T09:00:00Z",
    endsAt: "2026-10-02T09:22:00Z",
    silence: { by: "gil", reason: "vacuum" },
    notes: [{ id: "n7", at: "2026-10-02T09:10:00Z", by: "ada", text: "Restarted the pool." }],
    impact: { text: "Orders take seconds to place.", from: "catalog" },
    others: ["2026-09-20T14:02:00Z"],
  },
  {
    environment: "production",
    alert: "a1",
    name: "OrdersSlow",
    startsAt: "2026-09-20T14:02:00Z",
    endsAt: "2026-09-20T14:05:00Z",
    notes: [],
    others: ["2026-10-02T09:00:00Z"],
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
      loadBetween: (service, from, to) => {
        calls.push(["loadBetween", service, from, to])
        return Promise.resolve({ requests: series([1, 2]), errors: series([0, 0]), p99: series([0.1, 0.2]) })
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
      askAlert: (alert) => {
        calls.push(["askAlert", alert])
        return Promise.resolve(
          alert === "a1"
            ? {
                likelyCause: "A recent deploy raised latency.",
                evidence: [{ text: "storefront v2 deployed 26 min before it fired", href: "https://ci.example/1" }],
                nextSteps: ["Check the runbook", "Compare p99 before and after the deploy"],
                confidence: "medium" as const,
                model: "fake-model",
                read: ["Changed", "Runbook"],
                called: ["service orders"],
              }
            : "this alert was asked about less than a minute ago",
        )
      },
      tell: (alert) => {
        calls.push(["tell", alert])
        return Promise.resolve(
          alert === "a1"
            ? { url: "https://example.slack.com/archives/C0ORDERS/p1" }
            : "Slack refused the message: not_in_channel",
        )
      },
      firing: (alert, at) => {
        calls.push(at === undefined ? ["firing", alert] : ["firing", alert, at])
        const found = firings.find((each) => each.alert === alert && (at === undefined || each.startsAt === at))
        return Promise.resolve(found ?? "none")
      },
      around: (alert) => {
        calls.push(["around", alert])
        return Promise.resolve(alert === "a1" ? brief : undefined)
      },
    },
    sendLines: (batch) => {
      for (const handlers of watching) handlers.batch(batch)
    },
  }
}

/** A store for production, and a way to send it an event. */
