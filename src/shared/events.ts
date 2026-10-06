/**
 * What the server sends on `GET /events?env=…`, one named event per part of the page. The server encodes with these
 * and the pages decode with them, so neither can drift from the other.
 */
import { Schema } from "effect"
import { AgentState, DescribedAgent } from "./agents"
import { CodeHealth } from "./code"
import { Cost } from "./costs"
import { DeploysEvent } from "./deploys"

export { type Build, DeploysEvent } from "./deploys"

import { Debug, Job, Pod, Series } from "./workloads"

const optional = Schema.optionalKey
const Instant = Schema.String

export const Health = Schema.Literals(["healthy", "attention", "critical", "unknown"])
export type Health = typeof Health.Type

export const SourceKind = Schema.Literals(["metrics", "alerts", "cluster", "deploys", "builds"])
export type SourceKind = typeof SourceKind.Type

export const SourceStatus = Schema.Struct({
  kind: SourceKind,
  /** The tool the part is read from, by its own name, where one is set up. */
  tool: optional(Schema.String),
  /** off: not configured; waiting: not answered yet; ok; failing: did not answer, its parts shown with their age. */
  state: Schema.Literals(["off", "waiting", "ok", "failing"]),
  message: optional(Schema.String),
  answeredAt: optional(Instant),
})
export type SourceStatus = typeof SourceStatus.Type

const Link = Schema.Struct({ name: Schema.String, url: Schema.String })

export const CatalogEvent = Schema.Struct({
  environment: Schema.String,
  environments: Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String })),
  services: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: optional(Schema.String),
      owner: optional(Schema.String),
      category: optional(Schema.String),
      runbook: optional(Schema.String),
      repository: optional(Schema.String),
      links: Schema.Array(Link),
      debug: optional(Schema.Struct({ levels: Schema.Array(Schema.String) })),
      /** Found, not written: where, and the entry as YAML to put in the catalog. */
      discovered: optional(Schema.Struct({ from: Schema.String, yaml: Schema.String })),
    }),
  ),
  vitals: Schema.Array(Schema.Struct({ title: Schema.String, unit: optional(Schema.String) })),
  stores: optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: optional(Schema.String),
        category: optional(Schema.String),
        engine: Schema.String,
        links: Schema.Array(Link),
      }),
    ),
  ),
  teams: optional(
    Schema.Array(Schema.Struct({ name: Schema.String, title: Schema.String, links: Schema.Array(Link) })),
  ),
  agents: optional(Schema.Array(DescribedAgent)),
  jobs: optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: optional(Schema.String),
        owner: optional(Schema.String),
        category: optional(Schema.String),
        runbook: optional(Schema.String),
        kind: Schema.Literals(["CronJob", "Job", "ScheduledTask"]),
        links: Schema.Array(Link),
      }),
    ),
  ),
  map: Schema.Struct({
    collapse: optional(Schema.Union([Schema.Number, Schema.Literal("never")])),
    nodes: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        kind: Schema.String,
        service: optional(Schema.String),
        store: optional(Schema.String),
      }),
    ),
    edges: Schema.Array(
      Schema.Struct({
        from: Schema.String,
        to: Schema.String,
        label: optional(Schema.String),
        alert: optional(Schema.String),
      }),
    ),
  }),
})
export type CatalogEvent = typeof CatalogEvent.Type

export { Debug, Job, Pod, Series } from "./workloads"

const Stat = Schema.Struct({ title: Schema.String, unit: optional(Schema.String), series: Series })

export const Load = Schema.Struct({
  requests: optional(Series),
  errors: optional(Series),
  p99: optional(Series),
  stats: optional(Schema.Array(Stat)),
})
export type Load = typeof Load.Type

export const ServicesEvent = Schema.Struct({
  /** Only the services that changed since the last event, to be merged by name into those the page has. */
  partial: optional(Schema.Boolean),
  /** With `partial`, services whose series only moved along: the points each gained, to apply to those it has. */
  shifts: optional(
    Schema.Array(
      Schema.Struct({
        service: Schema.String,
        series: Schema.String,
        shift: Schema.Number,
        tail: Schema.Array(Schema.NullOr(Schema.Number)),
      }),
    ),
  ),
  sources: Schema.Array(SourceStatus),
  environments: Schema.Array(Schema.Struct({ name: Schema.String, worst: Health })),
  services: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      health: Health,
      reasons: Schema.Array(Schema.String),
      pods: Schema.Array(Pod),
      jobs: Schema.Array(Job),
      version: optional(Schema.String),
      load: Load,
      debug: optional(Debug),
      cost: optional(Cost),
      code: optional(CodeHealth),
    }),
  ),
  vitals: Schema.Array(Schema.Struct({ title: Schema.String, unit: optional(Schema.String), series: Series })),
  stores: optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        health: Health,
        reasons: Schema.Array(Schema.String),
        stats: Schema.Array(Stat),
      }),
    ),
  ),
  agents: optional(Schema.Array(AgentState)),
  /** Jobs no service owns: each one's health, and what its runtime last said of it. */
  jobs: optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        health: Health,
        reasons: Schema.Array(Schema.String),
        job: optional(Job),
        cost: optional(Cost),
      }),
    ),
  ),
  edges: Schema.Array(
    Schema.Struct({
      from: Schema.String,
      to: Schema.String,
      rate: Schema.NullOr(Schema.Number),
      alerting: Schema.Boolean,
    }),
  ),
})
export type ServicesEvent = typeof ServicesEvent.Type
export type ServiceState = ServicesEvent["services"][number]

export const Note = Schema.Struct({ id: Schema.String, at: Instant, by: Schema.String, text: Schema.String })
export type Note = typeof Note.Type

export const Alert = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  state: Schema.Literals(["firing", "pending", "silenced"]),
  severity: Schema.String,
  service: optional(Schema.String),
  store: optional(Schema.String),
  summary: optional(Schema.String),
  runbook: optional(Schema.String),
  startsAt: Instant,
  labels: Schema.Record(Schema.String, Schema.String),
  silence: optional(
    Schema.Struct({ id: Schema.String, by: Schema.String, reason: Schema.String, startsAt: Instant, endsAt: Instant }),
  ),
  notes: Schema.Array(Note),
  /** Its earlier firings, newest first, as far back as they are kept: who silenced each and why, and its notes. */
  history: optional(
    Schema.Array(
      Schema.Struct({
        startsAt: Instant,
        endsAt: optional(Instant),
        silence: optional(Schema.Struct({ by: Schema.String, reason: Schema.String })),
        notes: Schema.Array(Note),
      }),
    ),
  ),
  /** What it means for the people using the product: written on the page, in the catalog, or on its rule. */
  impact: optional(
    Schema.Struct({
      text: Schema.String,
      from: Schema.Literals(["page", "catalog", "rule"]),
      by: optional(Schema.String),
      at: optional(Instant),
    }),
  ),
  chart: optional(Schema.Struct({ points: Schema.Array(Schema.NullOr(Schema.Number)), threshold: Schema.Number })),
  /** The thread in its team's Slack channel, once this firing was told there. */
  thread: optional(Schema.Struct({ url: Schema.String })),
})
export type Alert = typeof Alert.Type

export const AlertsEvent = Schema.Struct({
  alerts: Schema.Array(Alert),
  resolved: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      service: optional(Schema.String),
      store: optional(Schema.String),
      startsAt: Instant,
      endsAt: Instant,
    }),
  ),
  silences: Schema.Boolean,
})
export type AlertsEvent = typeof AlertsEvent.Type

export const FeedItem = Schema.Struct({
  at: Instant,
  kind: Schema.Literals(["deploy", "build", "alert", "resolved", "silence", "note", "debug", "job"]),
  service: optional(Schema.String),
  text: Schema.String,
  who: optional(Schema.String),
  url: optional(Schema.String),
})
export type FeedItem = typeof FeedItem.Type

export const FeedEvent = Schema.Struct({ items: Schema.Array(FeedItem) })
export type FeedEvent = typeof FeedEvent.Type

export const events = {
  catalog: CatalogEvent,
  services: ServicesEvent,
  alerts: AlertsEvent,
  deploys: DeploysEvent,
  feed: FeedEvent,
} as const
export type EventName = keyof typeof events
export type Events = { readonly [Name in EventName]: (typeof events)[Name]["Type"] }

export const Me = Schema.Struct({
  name: Schema.String,
  role: Schema.Literals(["viewer", "operator"]),
  environments: Schema.Array(Schema.String),
  /** Estate writes to no tool here: no silences, no debug. */
  readOnly: optional(Schema.Boolean),
  /** A screen on the wall, signed in with the kiosk token. */
  kiosk: optional(Schema.Boolean),
  /** Ask AI is configured: the alert page may ask a model. */
  ai: optional(Schema.Boolean),
  /** Estate may post to Slack: an alert's card may tell its team. */
  slack: optional(Schema.Boolean),
  /** What a screen shows, where the settings say: its environments in turn, each for `every` seconds. */
  screen: optional(Schema.Struct({ environments: Schema.Array(Schema.String), every: Schema.Number })),
})
export type Me = typeof Me.Type
