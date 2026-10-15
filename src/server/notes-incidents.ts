/**
 * Incidents, kept beside the notes: each one whole, replaced as it changes, and swept by when it opened. The Postgres
 * and in-memory halves; DynamoDB's is in `notes-dynamodb-incidents.ts`.
 */
import { Effect, Option, Ref, Schema } from "effect"
import { Incident } from "../shared/incidents"
import type { Query } from "./query"
import type { Failure } from "./sources/run"
import { iso } from "./time"

export interface KeptIncidents {
  /** The incidents opened at `since` or later, newest first. */
  readonly incidents: (since: string) => Effect.Effect<ReadonlyArray<Incident>, Failure>
  /** Keeps an incident in place of the one with its id, if there is one. */
  readonly keepIncident: (incident: Incident) => Effect.Effect<void, Failure>
}

const { id: _id, openedAt: _openedAt, ...restFields } = Incident.fields

/** What of an incident its row or item has no field for, as JSON text. */
const decodeRest = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Struct(restFields)))

export const restOf = ({ id: _, openedAt: __, ...rest }: Incident): string => JSON.stringify(rest)

/** The incident an id, its opening and its rest make, or none when the rest is not one. */
export const incidentOf = (id: string, openedAt: string, rest: unknown): ReadonlyArray<Incident> =>
  Option.match(decodeRest(rest), { onNone: () => [], onSome: (decoded) => [{ id, openedAt, ...decoded }] })

export const createIncidents = `create table if not exists estate_incidents (
  id text primary key,
  opened_at timestamptz not null,
  record text not null
)`

const instant = (value: unknown) => iso(value instanceof Date ? value : String(value))

/** The incidents in Postgres. */
export const postgresIncidents = (query: Query): KeptIncidents => ({
  incidents: (since) =>
    Effect.suspend(() =>
      query("select id, opened_at, record from estate_incidents where opened_at >= $1 order by opened_at desc", [
        since,
      ]),
    ).pipe(
      Effect.map((rows) =>
        rows.flatMap((row) => incidentOf(String(row["id"]), instant(row["opened_at"]), row["record"])),
      ),
    ),
  keepIncident: (incident) =>
    Effect.suspend(() =>
      query(
        "insert into estate_incidents (id, opened_at, record) values ($1, $2, $3) on conflict (id) do update set opened_at = $2, record = $3",
        [incident.id, incident.openedAt, restOf(incident)],
      ),
    ).pipe(Effect.asVoid),
})

/** The incidents for as long as Estate runs. */
export const memoryIncidents = (kept: Ref.Ref<ReadonlyArray<Incident>>): KeptIncidents => ({
  incidents: (since) =>
    Effect.map(Ref.get(kept), (all) =>
      all.filter((each) => each.openedAt >= since).toSorted((a, b) => b.openedAt.localeCompare(a.openedAt)),
    ),
  keepIncident: (incident) => Ref.update(kept, (all) => [...all.filter((each) => each.id !== incident.id), incident]),
})
