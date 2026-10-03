/**
 * Notes on alerts: Estate's own record, kept in Postgres by environment and alert, with who and when (or in DynamoDB,
 * by `notes-dynamodb.ts`); in memory when no database is set, for trying Estate out.
 */
import { Context, Data, Effect, Layer, Ref } from "effect"
import type { Note } from "../shared/events"
import { type Failure, SourceFailure } from "./sources/run"
import { iso } from "./time"

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
      }),
    ),
  )

/** Notes for as long as Estate runs. */
export const memoryNotes = Layer.effect(Notes)(
  Effect.map(
    Effect.all([Ref.make<ReadonlyArray<StoredNote>>([]), Ref.make<ReadonlyArray<StoredImpact>>([])]),
    ([notes, impacts]) => ({
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
    }),
  ),
)
