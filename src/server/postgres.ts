/**
 * Estate's Postgres, through Effect's SQL client: one pool for its notes, impacts, alert history and threads, and,
 * when clustered, its runners and their messages. Every statement goes through `Query`, which a test stubs.
 */
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer, type Redacted } from "effect"
import { SqlClient } from "effect/sql/SqlClient"
import { type Notes, type NotesError, postgresNotes, type Query } from "./notes"
import { SourceFailure } from "./sources/run"

/** The pool, opened as Estate starts and closed as it stops. */
export const postgresLayer = (url: Redacted.Redacted) => Layer.orDie(PgClient.layer({ url, applicationName: "estate" }))

/** A statement and its parameters, run on the pool; a failure says which database. */
export const queryOf =
  (sql: SqlClient): Query =>
  (statement, parameters) =>
    sql
      .unsafe<Record<string, unknown>>(statement, parameters)
      .pipe(Effect.mapError((error) => new SourceFailure({ message: `the database: ${error.message}` })))

/** The notes kept in the pool's database. */
export const notesInPostgres: Layer.Layer<Notes, NotesError, SqlClient> = Layer.unwrap(
  Effect.gen(function* () {
    return postgresNotes(queryOf(yield* SqlClient))
  }),
)
