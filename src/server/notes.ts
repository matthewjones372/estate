/**
 * Notes on alerts: Estate's own record, kept in Postgres by environment and alert, with who and when (or in DynamoDB,
 * by `notes-dynamodb.ts`); in memory when no database is set, for trying Estate out.
 */
import { Context, Data, Effect, Layer, Ref } from "effect"
import type { Note } from "../shared/events"
import { type Failure, SourceFailure } from "./sources/run"
import type { StoredFiring } from "./state"
import { iso } from "./time"

export type { StoredFiring } from "./state"

export type StoredNote = Note & { readonly environment: string; readonly alert: string }

/** What an alert, by its name, means for the people using the product, as an operator wrote it on the page. */
export interface StoredImpact {
  readonly alert: string
  readonly text: string
  readonly by: string
  readonly at: string
}

export interface Notes {
  readonly all: Effect.Effect<ReadonlyArray<StoredNote>, Failure>
  readonly add: (note: StoredNote) => Effect.Effect<void, Failure>
  readonly remove: (id: string) => Effect.Effect<void, Failure>
  /** Removes every note written before `at`. */
  readonly removeBefore: (at: string) => Effect.Effect<void, Failure>
  readonly impacts: Effect.Effect<ReadonlyArray<StoredImpact>, Failure>
  /** Keeps an alert's impact in place of the one before, or forgets it when its text is empty. */
  readonly setImpact: (impact: StoredImpact) => Effect.Effect<void, Failure>
  /** The firings that started at `since` or later, newest first. */
  readonly firings: (since: string) => Effect.Effect<ReadonlyArray<StoredFiring>, Failure>
  /** Keeps a firing in place of the one with its environment, alert and start, if there is one. */
  readonly keepFiring: (firing: StoredFiring) => Effect.Effect<void, Failure>
  readonly removeFiringsBefore: (at: string) => Effect.Effect<void, Failure>
}
export const Notes = Context.Service<Notes>("estate/Notes")

export const NotesError = Data.TaggedError("NotesError")<{ readonly message: string }>

/** The little of a SQL client the notes need: a statement with its parameters, and the rows it returns. */
export type Query = (
  statement: string,
  parameters: ReadonlyArray<unknown>,
) => Promise<ReadonlyArray<Record<string, unknown>>>

const kept = 200

const create = `create table if not exists estate_notes (
  id text primary key,
  environment text not null,
  alert text not null,
  at timestamptz not null,
  by text not null,
  text text not null
)`

const createImpacts = `create table if not exists estate_impacts (
  alert text primary key,
  text text not null,
  by text not null,
  at timestamptz not null
)`

const createFirings = `create table if not exists estate_firings (
  environment text not null,
  alert text not null,
  name text not null,
  service text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  silenced_by text,
  silence_reason text,
  primary key (environment, alert, starts_at)
)`

const instant = (value: unknown) => iso(value instanceof Date ? value : String(value))

const firingOf = (row: Record<string, unknown>): StoredFiring => ({
  environment: String(row["environment"]),
  alert: String(row["alert"]),
  name: String(row["name"]),
  ...(row["service"] === null || row["service"] === undefined ? {} : { service: String(row["service"]) }),
  startsAt: instant(row["starts_at"]),
  ...(row["ends_at"] === null || row["ends_at"] === undefined ? {} : { endsAt: instant(row["ends_at"]) }),
  ...(row["silenced_by"] === null || row["silenced_by"] === undefined
    ? {}
    : { silence: { by: String(row["silenced_by"]), reason: String(row["silence_reason"] ?? "") } }),
})

const run = (query: Query, statement: string, parameters: ReadonlyArray<unknown> = []) =>
  Effect.tryPromise({
    try: () => query(statement, parameters),
    catch: (error) => new SourceFailure({ message: `the notes database: ${String(error)}` }),
  })

const asNote = ({ id, environment, alert, at, by, text }: Record<string, unknown>): StoredNote => ({
  id: String(id),
  environment: String(environment),
  alert: String(alert),
  at: iso(at instanceof Date ? at : String(at)),
  by: String(by),
  text: String(text),
})

/** Notes in Postgres, its table made if it is not there. */
export const postgresNotes = (query: Query) =>
  Layer.effect(Notes)(
    run(query, create).pipe(
      Effect.andThen(run(query, createImpacts)),
      Effect.andThen(run(query, createFirings)),
      Effect.mapError((failure) => new NotesError(failure)),
      Effect.as({
        all: run(
          query,
          `select id, environment, alert, at, by, text from estate_notes order by at desc limit ${kept}`,
        ).pipe(Effect.map((rows) => rows.map(asNote))),
        add: (note: StoredNote) =>
          run(
            query,
            "insert into estate_notes (id, environment, alert, at, by, text) values ($1, $2, $3, $4, $5, $6)",
            [note.id, note.environment, note.alert, note.at, note.by, note.text],
          ).pipe(Effect.asVoid),
        remove: (id: string) => run(query, "delete from estate_notes where id = $1", [id]).pipe(Effect.asVoid),
        removeBefore: (at: string) => run(query, "delete from estate_notes where at < $1", [at]).pipe(Effect.asVoid),
        impacts: run(query, "select alert, text, by, at from estate_impacts").pipe(
          Effect.map((rows) =>
            rows.map(({ alert, text, by, at }) => ({
              alert: String(alert),
              text: String(text),
              by: String(by),
              at: iso(at instanceof Date ? at : String(at)),
            })),
          ),
        ),
        setImpact: (impact: StoredImpact) =>
          (impact.text === ""
            ? run(query, "delete from estate_impacts where alert = $1", [impact.alert])
            : run(
                query,
                "insert into estate_impacts (alert, text, by, at) values ($1, $2, $3, $4) on conflict (alert) do update set text = $2, by = $3, at = $4",
                [impact.alert, impact.text, impact.by, impact.at],
              )
          ).pipe(Effect.asVoid),
        firings: (since: string) =>
          run(
            query,
            "select environment, alert, name, service, starts_at, ends_at, silenced_by, silence_reason from estate_firings where starts_at >= $1 order by starts_at desc",
            [since],
          ).pipe(Effect.map((rows) => rows.map(firingOf))),
        keepFiring: (firing: StoredFiring) =>
          run(
            query,
            "insert into estate_firings (environment, alert, name, starts_at, ends_at, silenced_by, silence_reason, service) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (environment, alert, starts_at) do update set ends_at = $5, silenced_by = $6, silence_reason = $7",
            [
              firing.environment,
              firing.alert,
              firing.name,
              firing.startsAt,
              firing.endsAt ?? null,
              firing.silence?.by ?? null,
              firing.silence?.reason ?? null,
              firing.service ?? null,
            ],
          ).pipe(Effect.asVoid),
        removeFiringsBefore: (at: string) =>
          run(query, "delete from estate_firings where starts_at < $1", [at]).pipe(Effect.asVoid),
      }),
    ),
  )

export const sameFiring = (a: StoredFiring, b: StoredFiring) =>
  a.environment === b.environment && a.alert === b.alert && a.startsAt === b.startsAt

/** Notes, impacts and firings for as long as Estate runs. */
export const memoryNotes = Layer.effect(Notes)(
  Effect.map(
    Effect.all([
      Ref.make<ReadonlyArray<StoredNote>>([]),
      Ref.make<ReadonlyArray<StoredImpact>>([]),
      Ref.make<ReadonlyArray<StoredFiring>>([]),
    ]),
    ([notes, impacts, firings]) => ({
      all: Effect.map(Ref.get(notes), (kept) => [...kept].reverse()),
      add: (note: StoredNote) => Ref.update(notes, (kept) => [...kept, note]),
      remove: (id: string) => Ref.update(notes, (kept) => kept.filter((note) => note.id !== id)),
      removeBefore: (at: string) => Ref.update(notes, (kept) => kept.filter((note) => note.at >= at)),
      impacts: Ref.get(impacts),
      setImpact: (impact: StoredImpact) =>
        Ref.update(impacts, (kept) => [
          ...kept.filter((each) => each.alert !== impact.alert),
          ...(impact.text === "" ? [] : [impact]),
        ]),
      firings: (since: string) =>
        Effect.map(Ref.get(firings), (kept) =>
          kept.filter((firing) => firing.startsAt >= since).toSorted((a, b) => b.startsAt.localeCompare(a.startsAt)),
        ),
      keepFiring: (firing: StoredFiring) =>
        Ref.update(firings, (kept) => [...kept.filter((each) => !sameFiring(each, firing)), firing]),
      removeFiringsBefore: (at: string) =>
        Ref.update(firings, (kept) => kept.filter((firing) => firing.startsAt >= at)),
    }),
  ),
)
