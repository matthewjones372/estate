/**
 * A firing's events, kept beside the notes: who did what to it and when, appended only, read in order for its
 * timeline, and swept with the firing. The Postgres and in-memory halves; DynamoDB's is in `notes-dynamodb.ts`.
 */
import { Effect, Ref } from "effect"
import type { FiringEvent } from "../shared/timeline"
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

export interface FiringEvents {
  /** A firing's events, oldest first. */
  readonly events: (firing: FiringKey) => Effect.Effect<ReadonlyArray<StoredEvent>, Failure>
  readonly addEvent: (event: StoredEvent) => Effect.Effect<void, Failure>
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
  "alter table estate_events add column if not exists read_logs boolean",
]

const instant = (value: unknown) => iso(value instanceof Date ? value : String(value))

const eventOf = (row: Record<string, unknown>): StoredEvent => ({
  id: String(row["id"]),
  environment: String(row["environment"]),
  alert: String(row["alert"]),
  startsAt: instant(row["starts_at"]),
  at: instant(row["at"]),
  by: String(row["by"]),
  kind: row["kind"] as StoredEvent["kind"],
  text: String(row["text"]),
  ...(row["link"] === null || row["link"] === undefined ? {} : { link: String(row["link"]) }),
  ...(typeof row["read_logs"] === "boolean" ? { readLogs: row["read_logs"] } : {}),
})

/** The events in Postgres, and the statement that sweeps those of firings begun before a time. */
export const postgresEvents = (
  query: Query,
): FiringEvents & { readonly sweep: (at: string) => Effect.Effect<void, Failure> } => ({
  events: (firing) =>
    Effect.suspend(() =>
      query(
        "select id, environment, alert, starts_at, at, by, kind, text, link, read_logs from estate_events where environment = $1 and alert = $2 and starts_at = $3 order by at",
        [firing.environment, firing.alert, firing.startsAt],
      ),
    ).pipe(Effect.map((rows) => rows.map(eventOf))),
  addEvent: (event) =>
    Effect.suspend(() =>
      query(
        "insert into estate_events (id, environment, alert, starts_at, at, by, kind, text, link, read_logs) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        [
          event.id,
          event.environment,
          event.alert,
          event.startsAt,
          event.at,
          event.by,
          event.kind,
          event.text,
          event.link ?? null,
          event.readLogs ?? null,
        ],
      ),
    ).pipe(Effect.asVoid),
  sweep: (at) =>
    Effect.suspend(() => query("delete from estate_events where starts_at < $1", [at])).pipe(Effect.asVoid),
})

const sameFiringAs = (firing: FiringKey) => (event: StoredEvent) =>
  event.environment === firing.environment &&
  event.alert === firing.alert &&
  sameInstant(event.startsAt, firing.startsAt)

/** Oldest first by instant, as Postgres orders them, though one time is written to the second and another to the ms. */
export const inOrder = (events: ReadonlyArray<StoredEvent>) =>
  events.toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))

/** The events for as long as Estate runs. */
export const memoryEvents = (kept: Ref.Ref<ReadonlyArray<StoredEvent>>): FiringEvents => ({
  events: (firing) => Effect.map(Ref.get(kept), (all) => inOrder(all.filter(sameFiringAs(firing)))),
  addEvent: (event) => Ref.update(kept, (all) => [...all, event]),
})

/** The events of firings begun before `at`, gone from memory. */
export const sweepMemoryEvents = (kept: Ref.Ref<ReadonlyArray<StoredEvent>>, at: string) =>
  Ref.update(kept, (all) => all.filter((event) => Date.parse(event.startsAt) >= Date.parse(at)))
