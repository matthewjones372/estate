/**
 * What the server sends on `GET /events?env=…`, one named event per part of the page. The server encodes with these
 * and the pages decode with them, so neither can drift from the other.
 */
import { Schema } from "effect"

const optional = Schema.optionalKey
const Instant = Schema.String

export const Health = Schema.Literals(["healthy", "attention", "critical", "unknown"])
export type Health = typeof Health.Type

export const SourceKind = Schema.Literals(["metrics", "alerts", "cluster", "deploys", "builds"])
export type SourceKind = typeof SourceKind.Type

export const SourceStatus = Schema.Struct({
  kind: SourceKind,
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
      runbook: optional(Schema.String),
      repository: optional(Schema.String),
      links: Schema.Array(Link),
      debug: optional(Schema.Struct({ levels: Schema.Array(Schema.String) })),
    }),
  ),
  vitals: Schema.Array(Schema.Struct({ title: Schema.String, unit: optional(Schema.String) })),
  stores: optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: optional(Schema.String),
        engine: Schema.String,
        links: Schema.Array(Link),
      }),
    ),
  ),
  map: Schema.Struct({
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

/** A metric now and over the last hour, a point a minute; null where the source had nothing. */
export const Series = Schema.Struct({
  now: Schema.NullOr(Schema.Number),
  points: Schema.Array(Schema.NullOr(Schema.Number)),
})
export type Series = typeof Series.Type

export const Pod = Schema.Struct({
  name: Schema.String,
  phase: Schema.String,
  ready: Schema.Boolean,
  restarts: Schema.Number,
  image: optional(Schema.String),
  node: optional(Schema.String),
  startedAt: optional(Instant),
})
export type Pod = typeof Pod.Type

const JobRun = Schema.Struct({
  name: Schema.String,
  outcome: Schema.Literals(["running", "succeeded", "failed"]),
  startedAt: Instant,
  finishedAt: optional(Instant),
  message: optional(Schema.String),
})

export const Job = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["CronJob", "Job", "ScheduledTask"]),
  schedule: optional(Schema.String),
  suspended: Schema.Boolean,
  runs: Schema.Array(JobRun),
  next: optional(Instant),
  missed: optional(Instant),
})
export type Job = typeof Job.Type

export const Debug = Schema.Struct({
  level: Schema.String,
  on: Schema.Boolean,
  since: optional(Instant),
  until: optional(Instant),
  by: optional(Schema.String),
})
export type Debug = typeof Debug.Type

const Stat = Schema.Struct({ title: Schema.String, unit: optional(Schema.String), series: Series })

export const Load = Schema.Struct({
  requests: optional(Series),
  errors: optional(Series),
  p99: optional(Series),
  stats: optional(Schema.Array(Stat)),
})
export type Load = typeof Load.Type

export const ServicesEvent = Schema.Struct({
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
  chart: optional(Schema.Struct({ points: Schema.Array(Schema.NullOr(Schema.Number)), threshold: Schema.Number })),
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

const Build = Schema.Struct({
  sha: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["success", "failure", "running", "queued", "cancelled"]),
  at: Instant,
  url: Schema.String,
  /** The job that failed, where the tool names it. */
  job: optional(Schema.String),
})
export type Build = typeof Build.Type

export const DeploysEvent = Schema.Struct({
  environments: Schema.Array(Schema.String),
  services: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      builds: Schema.Array(Build),
      environments: Schema.Array(
        Schema.Struct({
          environment: Schema.String,
          seen: Schema.Boolean,
          running: optional(Schema.String),
          chosen: optional(Schema.Struct({ version: Schema.String, ready: Schema.Boolean, at: optional(Instant) })),
          stalled: optional(Schema.String),
        }),
      ),
    }),
  ),
})
export type DeploysEvent = typeof DeploysEvent.Type

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
})
export type Me = typeof Me.Type

/** A service's log line, as the page shows it. */
export const LogLine = Schema.Struct({
  at: Instant,
  pod: optional(Schema.String),
  level: optional(Schema.String),
  text: Schema.String,
})

export type LogLine = typeof LogLine.Type

/** What `GET /logs` sends each time it reads: the new lines, whether it had to skip some, or why it could not read. */
export const LogBatch = Schema.Struct({
  lines: Schema.Array(LogLine),
  skipped: Schema.Boolean,
  failed: optional(Schema.String),
})
export type LogBatch = typeof LogBatch.Type

/** What `GET /api/logs/errors` answers: where the lines came from, and the errors grouped by message. */
export const ErrorGroups = Schema.Struct({
  from: Schema.String,
  groups: Schema.Array(
    Schema.Struct({
      shape: Schema.String,
      count: Schema.Number,
      firstSeen: Instant,
      lastSeen: Instant,
      pods: Schema.Array(Schema.String),
      examples: Schema.Array(LogLine),
    }),
  ),
})
export type ErrorGroups = typeof ErrorGroups.Type
