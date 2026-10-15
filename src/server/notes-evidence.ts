/**
 * An incident's evidence, kept beside the notes: each set whole, as JSON, under the incident, read oldest first. The
 * Postgres and in-memory halves; DynamoDB's is in `notes-dynamodb-evidence.ts`.
 */
import { Effect, Option, Ref, Schema } from "effect"
import { EvidenceSet } from "../shared/evidence"
import type { Query } from "./query"
import type { Failure } from "./sources/run"

export interface KeptEvidence {
  /** An incident's evidence, a set a keep, oldest first. */
  readonly evidence: (incident: string) => Effect.Effect<ReadonlyArray<EvidenceSet>, Failure>
  readonly keepEvidence: (incident: string, set: EvidenceSet) => Effect.Effect<void, Failure>
}

const decodeSet = Schema.decodeUnknownOption(Schema.fromJsonString(EvidenceSet))

/** The set kept as `record`, or none when it is not one. */
export const setOf = (record: unknown): ReadonlyArray<EvidenceSet> =>
  Option.match(decodeSet(record), { onNone: () => [], onSome: (set) => [set] })

export const oldestFirst = (sets: ReadonlyArray<EvidenceSet>) =>
  sets.toSorted((a, b) => Date.parse(a.keptAt) - Date.parse(b.keptAt))

export const createEvidence = `create table if not exists estate_evidence (
  id text primary key,
  incident text not null,
  kept_at timestamptz not null,
  record text not null
)`

export const postgresEvidence = (query: Query): KeptEvidence => ({
  evidence: (incident) =>
    Effect.suspend(() =>
      query("select record from estate_evidence where incident = $1 order by kept_at", [incident]),
    ).pipe(Effect.map((rows) => oldestFirst(rows.flatMap((row) => setOf(row["record"]))))),
  keepEvidence: (incident, set) =>
    Effect.suspend(() =>
      query("insert into estate_evidence (id, incident, kept_at, record) values ($1, $2, $3, $4)", [
        set.id,
        incident,
        set.keptAt,
        JSON.stringify(set),
      ]),
    ).pipe(Effect.asVoid),
})

export const memoryEvidence = (kept: Ref.Ref<ReadonlyMap<string, ReadonlyArray<EvidenceSet>>>): KeptEvidence => ({
  evidence: (incident) => Effect.map(Ref.get(kept), (all) => oldestFirst(all.get(incident) ?? [])),
  keepEvidence: (incident, set) =>
    Ref.update(kept, (all) => new Map([...all, [incident, [...(all.get(incident) ?? []), set]]])),
})
