/**
 * A firing's events, kept beside the notes: who did what to it and when, appended only, read in order for its
 * timeline, and swept with the firing. An incident's own events, on it rather than one firing, are kept the same way. The Postgres and in-memory halves; DynamoDB's is in `notes-dynamodb.ts`.
 */
import { Effect, Ref } from "effect"
import type { EventSource, FiringEvent } from "../shared/timeline"
import type { Query } from "./query"
import type { Failure } from "./sources/run"
import { iso, sameInstant } from "./time"

/** Which firing: its environment, its alert and when it started. */
export interface FiringKey {
  readonly environment: string
  readonly alert: string
  readonly startsAt: string
}

export type StoredEvent = FiringEvent & FiringKey

export type StoredIncidentEvent = FiringEvent & { readonly incident: string }

export interface FiringEvents {
  /** A firing's events, oldest first. */
  readonly events: (firing: FiringKey) => Effect.Effect<ReadonlyArray<StoredEvent>, Failure>
  readonly addEvent: (event: StoredEvent) => Effect.Effect<void, Failure>
  /** An incident's own events, oldest first. */
  readonly incidentEvents: (incident: string) => Effect.Effect<ReadonlyArray<StoredIncidentEvent>, Failure>
  readonly addIncidentEvent: (event: StoredIncidentEvent) => Effect.Effect<void, Failure>
}

export const createEvents = [
  `create table if not exists estate_events (
  id text primary key,
  environment text not null,
  alert text not null,
  starts_at timestamptz not null,
  at timestamptz not null,
  by text not null,
  kind text not null,
  text text not null,
  link text
)`,
  "create index if not exists estate_events_firing on estate_events (environment, alert, starts_at, at)",
  "alter table estate_events add column if not exists read_logs boolean, add column if not exists recorded_at timestamptz, add column if not exists source text, add column if not exists service text",
  `create table if not exists estate_incident_events (
  id text primary key,
  incident text not null,
  at timestamptz not null,
  by text not null,
  kind text not null,
  text text not null,
  link text,
  read_logs boolean,
  recorded_at timestamptz not null,
  source text not null,
  service text
)`,
  "create index if not exists estate_incident_events_incident on estate_incident_events (incident, at)",
]

const instant = (value: unknown) => iso(value instanceof Date ? value : String(value))

const present = (value: unknown) => value !== null && value !== undefined

// A row kept before events said where they came from was seen live, so it was kept when it happened.
const said = (row: Record<string, unknown>): FiringEvent => ({
  id: String(row["id"]),
  at: instant(row["at"]),
  recordedAt: instant(present(row["recorded_at"]) ? row["recorded_at"] : row["at"]),
  source: present(row["source"]) ? (row["source"] as EventSource) : "seen",
  ...(present(row["service"]) ? { service: String(row["service"]) } : {}),
  by: String(row["by"]),
  kind: row["kind"] as FiringEvent["kind"],
  text: String(row["text"]),
  ...(present(row["link"]) ? { link: String(row["link"]) } : {}),
  ...(typeof row["read_logs"] === "boolean" ? { readLogs: row["read_logs"] } : {}),
})

const eventOf = (row: Record<string, unknown>): StoredEvent => ({
  ...said(row),
  environment: String(row["environment"]),
  alert: String(row["alert"]),
  startsAt: instant(row["starts_at"]),
})

const saying = (event: FiringEvent) => [
  event.at,
  event.by,
  event.kind,
  event.text,
  event.link ?? null,
  event.readLogs ?? null,
  event.recordedAt,
  event.source,
  event.service ?? null,
]

const columns = "at, by, kind, text, link, read_logs, recorded_at, source, service"

/** The events in Postgres. */
export const postgresEvents = (query: Query): FiringEvents => ({
  events: (firing) =>
    Effect.suspend(() =>
      query(
        `select id, environment, alert, starts_at, ${columns} from estate_events where environment = $1 and alert = $2 and starts_at = $3 order by at`,
        [firing.environment, firing.alert, firing.startsAt],
      ),
    ).pipe(Effect.map((rows) => rows.map(eventOf))),
  addEvent: (event) =>
    Effect.suspend(() =>
      query(
        `insert into estate_events (id, environment, alert, starts_at, ${columns}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [event.id, event.environment, event.alert, event.startsAt, ...saying(event)],
      ),
    ).pipe(Effect.asVoid),
  incidentEvents: (incident) =>
    Effect.suspend(() =>
      query(`select id, incident, ${columns} from estate_incident_events where incident = $1 order by at`, [incident]),
    ).pipe(Effect.map((rows) => rows.map((row) => ({ ...said(row), incident: String(row["incident"]) })))),
  addIncidentEvent: (event) =>
    Effect.suspend(() =>
      query(
        `insert into estate_incident_events (id, incident, ${columns}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [event.id, event.incident, ...saying(event)],
      ),
    ).pipe(Effect.asVoid),
})

const sameFiringAs = (firing: FiringKey) => (event: StoredEvent) =>
  event.environment === firing.environment &&
  event.alert === firing.alert &&
  sameInstant(event.startsAt, firing.startsAt)

/** Oldest first by instant, as Postgres orders them, though one time is written to the second and another to the ms. */
export const inOrder = <A extends FiringEvent>(events: ReadonlyArray<A>) =>
  events.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))

/** The events for as long as Estate runs. */
export const memoryEvents = (
  kept: Ref.Ref<ReadonlyArray<StoredEvent>>,
  own: Ref.Ref<ReadonlyArray<StoredIncidentEvent>>,
): FiringEvents => ({
  events: (firing) => Effect.map(Ref.get(kept), (all) => inOrder(all.filter(sameFiringAs(firing)))),
  addEvent: (event) => Ref.update(kept, (all) => [...all, event]),
  incidentEvents: (incident) =>
    Effect.map(Ref.get(own), (all) => inOrder(all.filter((event) => event.incident === incident))),
  addIncidentEvent: (event) => Ref.update(own, (all) => [...all, event]),
})

/** The events of firings begun before `at`, gone from memory. */
export const sweepMemoryEvents = (
  kept: Ref.Ref<ReadonlyArray<StoredEvent>>,
  at: string,
  keep: (firing: FiringKey) => boolean,
) => Ref.update(kept, (all) => all.filter((event) => Date.parse(event.startsAt) >= Date.parse(at) || keep(event)))
