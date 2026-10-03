/** A page's worth of events, and a way to render a part of the page with them, for tests. */

import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { Events, Me } from "../shared/events"
import { type Actions, EstateContext } from "./context"
import { createLive, type Handlers } from "./live"
import type { Page } from "./route"

export const now = Date.parse("2026-10-03T12:00:00Z")

const series = (points: ReadonlyArray<number>) => ({ now: points.at(-1) ?? null, points })

export const events: Events = {
  catalog: {
    environment: "production",
    environments: [
      { name: "staging", title: "Staging" },
      { name: "production", title: "Production, three machines" },
    ],
    services: [
      {
        name: "storefront",
        description: "The shop's pages",
        owner: "web",
        runbook: "https://runbooks.example/storefront",
        repository: "github:example/storefront",
        links: [
          { name: "logs", url: "https://logs.example/storefront" },
          { name: "traces", url: "https://traces.example/storefront" },
        ],
        debug: { levels: ["INFO", "DEBUG"] },
      },
      { name: "orders", links: [] },
    ],
    vitals: [{ title: "Orders", unit: "/s" }],
    map: {
      nodes: [
        { id: "storefront", title: "storefront", kind: "service", service: "storefront" },
        { id: "orders", title: "orders", kind: "service", service: "orders" },
        { id: "db", title: "Postgres", kind: "store" },
      ],
      edges: [
        { from: "storefront", to: "orders", label: "orders", alert: "OrdersSlow" },
        { from: "orders", to: "db" },
      ],
    },
  },
  services: {
    sources: [
      { kind: "alerts", state: "ok", answeredAt: "2026-10-03T12:00:00Z" },
      { kind: "cluster", state: "ok", answeredAt: "2026-10-03T12:00:00Z" },
      { kind: "deploys", state: "ok" },
      { kind: "metrics", state: "failing", answeredAt: "2026-10-03T11:55:00Z", message: "connection refused" },
      { kind: "builds", state: "off" },
    ],
    environments: [
      { name: "staging", worst: "healthy" },
      { name: "production", worst: "attention" },
    ],
    services: [
      {
        name: "storefront",
        health: "attention",
        reasons: ["OrdersSlow is firing"],
        pods: [
          {
            name: "storefront-1",
            phase: "Running",
            ready: true,
            restarts: 0,
            node: "one",
            startedAt: "2026-10-03T10:00:00Z",
            image: "r/storefront:v2",
          },
        ],
        version: "v2",
        jobs: [
          {
            name: "storefront-sitemap",
            kind: "CronJob",
            schedule: "0 * * * *",
            suspended: false,
            runs: [
              {
                name: "storefront-sitemap-29",
                outcome: "failed",
                startedAt: "2026-10-03T11:00:00Z",
                finishedAt: "2026-10-03T11:02:00Z",
                message: "BackoffLimitExceeded",
              },
              {
                name: "storefront-sitemap-28",
                outcome: "succeeded",
                startedAt: "2026-10-03T10:00:00Z",
                finishedAt: "2026-10-03T10:01:30Z",
              },
            ],
            next: "2026-10-03T13:00:00Z",
            missed: "2026-10-03T12:00:00Z",
          },
        ],
        load: {
          requests: series([10, 12, 14]),
          errors: series([0, 0, 0]),
          p99: series([0.1, 0.2, 0.25]),
          stats: [
            { title: "Heap", unit: "bytes", series: series([300 * 1024 ** 2, 310 * 1024 ** 2]) },
            { title: "Threads", series: series([40, 42]) },
          ],
        },
        debug: { level: "DEBUG", on: true, since: "2026-10-03T11:50:00Z", until: "2026-10-03T12:05:00Z", by: "ada" },
      },
      { name: "orders", health: "healthy", reasons: [], pods: [], jobs: [], load: {} },
    ],
    vitals: [{ title: "Orders", unit: "/s", series: series([3, 4, 5]) }],
    edges: [
      { from: "storefront", to: "orders", rate: 12, alerting: true },
      { from: "orders", to: "db", rate: null, alerting: false },
    ],
  },
  alerts: {
    alerts: [
      {
        id: "a1",
        name: "OrdersSlow",
        state: "firing",
        severity: "warning",
        service: "storefront",
        summary: "Orders are slow",
        runbook: "https://runbooks.example/orders-slow",
        startsAt: "2026-10-03T11:46:00Z",
        labels: {},
        notes: [{ id: "n1", at: "2026-10-03T11:50:00Z", by: "gil", text: "On it." }],
        chart: { points: [0.1, 0.2, 0.3], threshold: 0.2 },
      },
      {
        id: "a2",
        name: "DiskFilling",
        state: "silenced",
        severity: "warning",
        startsAt: "2026-10-03T09:00:00Z",
        labels: {},
        notes: [],
        silence: {
          id: "s1",
          by: "ada",
          reason: "resizing",
          startsAt: "2026-10-03T09:05:00Z",
          endsAt: "2026-10-03T15:00:00Z",
        },
      },
      {
        id: "a3",
        name: "QueueGrowing",
        state: "pending",
        severity: "critical",
        service: "orders",
        startsAt: "2026-10-03T11:58:00Z",
        labels: {},
        notes: [],
      },
    ],
    resolved: [
      { name: "Restarted", service: "orders", startsAt: "2026-10-03T08:00:00Z", endsAt: "2026-10-03T08:08:00Z" },
    ],
    silences: true,
  },
  deploys: {
    environments: ["staging", "production"],
    services: [
      {
        name: "storefront",
        builds: [
          {
            sha: "c556728aa",
            title: "Faster pages",
            status: "success",
            at: "2026-10-03T11:00:00Z",
            url: "https://github.example/run/1",
          },
        ],
        environments: [
          {
            environment: "staging",
            seen: true,
            running: "v2",
            chosen: { version: "v2", ready: true, at: "2026-10-03T11:10:00Z" },
          },
          {
            environment: "production",
            seen: true,
            running: "v2",
            chosen: { version: "v2", ready: true, at: "2026-10-03T11:20:00Z" },
          },
        ],
      },
      {
        name: "orders",
        builds: [
          {
            sha: "3889c5c",
            title: "New basket",
            status: "running",
            at: "2026-10-03T11:56:00Z",
            url: "https://github.example/run/2",
          },
        ],
        environments: [
          {
            environment: "production",
            seen: true,
            running: "v7",
            chosen: { version: "v8", ready: false },
            stalled: "cannot scan the registry",
          },
        ],
      },
    ],
  },
  feed: {
    items: [
      { at: "2026-10-03T11:50:00Z", kind: "debug", service: "storefront", who: "ada", text: "debug on until 12:05" },
    ],
  },
}

export interface Recorded {
  readonly calls: Array<readonly [string, ...ReadonlyArray<unknown>]>
  readonly actions: Actions
}

export const recording = (): Recorded => {
  const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = []
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
    },
  }
}

/** A store that has heard `heard` for production. */
export const heard = (sent: Partial<Events> = events) => {
  let handlers: Handlers | undefined
  const live = createLive(
    (_, given) => {
      handlers = given
      return () => undefined
    },
    "production",
    () => now,
  )
  handlers?.onOpen()
  for (const [name, data] of Object.entries(sent)) handlers?.onEvent(name as keyof Events, JSON.stringify(data))
  return live
}

export const operator: Me = { name: "ada lovelace", role: "operator", environments: ["staging", "production"] }

export const render = (
  node: ReactNode,
  options: { readonly page?: Page; readonly me?: Me; readonly sent?: Partial<Events>; readonly actions?: Actions } = {},
) =>
  renderToStaticMarkup(
    <EstateContext.Provider
      value={{
        live: heard(options.sent),
        me: options.me ?? operator,
        page: options.page ?? { page: "overview" },
        actions: options.actions ?? recording().actions,
        now: () => now,
      }}
    >
      {node}
    </EstateContext.Provider>,
  )
