/**
 * Sweeping the notes (spec 0047). Firings begun before a time go with their events, but those an incident still
 * holds stay. Incidents opened before a time go with their own events and evidence. These are the Postgres and
 * in-memory halves, and DynamoDB's are beside its tables.
 */
import { Effect, Ref } from "effect"
import type { EvidenceSet } from "../shared/evidence"
import type { Incident } from "../shared/incidents"
import type { FiringKey, StoredIncidentEvent } from "./notes-events"
import type { Query } from "./query"
import type { Failure } from "./sources/run"
import { sameInstant } from "./time"

export interface Sweeps {
  /** Removes the firings begun before `at`, and their events, but those in `keep`. */
  readonly removeFiringsBefore: (at: string, keep?: ReadonlyArray<FiringKey>) => Effect.Effect<void, Failure>
  /** Removes the incidents opened before `at`, with their own events and evidence. */
  readonly removeIncidentsBefore: (at: string) => Effect.Effect<void, Failure>
}

/** Whether a firing is one of `keep`, however each start is written. */
export const keptBy = (keep: ReadonlyArray<FiringKey>) => (firing: FiringKey) =>
  keep.some(
    (each) =>
      each.environment === firing.environment &&
      each.alert === firing.alert &&
      sameInstant(each.startsAt, firing.startsAt),
  )

// The firings kept are passed as three arrays, unnested into rows, so however many there are it is one statement.
const unkept = (table: string) =>
  `starts_at < $1 and not exists (select 1 from unnest($2::text[], $3::text[], $4::timestamptz[]) as kept(environment, alert, starts_at) where kept.environment = ${table}.environment and kept.alert = ${table}.alert and kept.starts_at = ${table}.starts_at)`

const incidentsBefore = "incident in (select id from estate_incidents where opened_at < $1)"

export const postgresSweeps = (query: Query): Sweeps => {
  const run = (statement: string, parameters: ReadonlyArray<unknown>) =>
    Effect.suspend(() => query(statement, parameters)).pipe(Effect.asVoid)
  return {
    removeFiringsBefore: (at, keep = []) => {
      const kept = [
        keep.map((each) => each.environment),
        keep.map((each) => each.alert),
        keep.map((each) => each.startsAt),
      ]
      return Effect.forEach(
        ["estate_firings", "estate_events"],
        (table) => run(`delete from ${table} where ${unkept(table)}`, [at, ...kept]),
        { discard: true },
      )
    },
    removeIncidentsBefore: (at) =>
      Effect.forEach(
        [
          `delete from estate_incident_events where ${incidentsBefore}`,
          `delete from estate_evidence where ${incidentsBefore}`,
          "delete from estate_incidents where opened_at < $1",
        ],
        (statement) => run(statement, [at]),
        { discard: true },
      ),
  }
}

/** The incidents opened before `at` gone from memory, with their own events and evidence. */
export const sweepMemoryIncidents = (
  incidents: Ref.Ref<ReadonlyArray<Incident>>,
  own: Ref.Ref<ReadonlyArray<StoredIncidentEvent>>,
  evidence: Ref.Ref<ReadonlyMap<string, ReadonlyArray<EvidenceSet>>>,
  at: string,
) =>
  Effect.gen(function* () {
    const all = yield* Ref.get(incidents)
    const gone = new Set(all.filter((each) => each.openedAt < at).map((each) => each.id))
    yield* Ref.set(
      incidents,
      all.filter((each) => !gone.has(each.id)),
    )
    yield* Ref.update(own, (events) => events.filter((event) => !gone.has(event.incident)))
    yield* Ref.update(evidence, (sets) => new Map([...sets].filter(([id]) => !gone.has(id))))
  })
