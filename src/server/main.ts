/**
 * Estate's entry. `estate check catalog.yaml` checks a catalog for an estate's own CI; anything else serves, with
 * the settings from `ESTATE_SETTINGS` (by default `/etc/estate/estate.yaml`).
 */
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { SQL } from "bun"
import { Console, Effect, Layer, Redacted, Result } from "effect"
import { HttpRouter } from "effect/http"
import type { Mistake } from "../shared/shape"
import { application, background, prepare, services } from "./app"
import { parseCatalog, readCatalogText } from "./catalog-file"
import { memoryNotes, postgresNotes, type Query } from "./notes"
import { liveRemote } from "./remote"
import { builtWeb } from "./web"

/** Bun's Postgres client, as the little the notes need of one. */
const sqlOf = (url: string): Query => {
  const sql = new SQL(url)
  return (statement, parameters) => sql.unsafe(statement, [...parameters])
}

const listMistakes = (file: string, mistakes: ReadonlyArray<Mistake>) =>
  Console.error(
    `${file} has ${mistakes.length} mistake${mistakes.length === 1 ? "" : "s"}:\n${mistakes.map((each) => `  ${each.at}: ${each.message}`).join("\n")}`,
  ).pipe(
    Effect.andThen(
      Effect.sync(() => {
        process.exitCode = 1
      }),
    ),
  )

const check = (path: string) =>
  readCatalogText(path).pipe(
    Effect.map((text) => parseCatalog(path, text)),
    Effect.flatMap((parsed) =>
      Result.isSuccess(parsed) ? Console.log(`${path} is a good catalog`) : listMistakes(path, parsed.failure.mistakes),
    ),
    Effect.catchTag("CatalogError", (error) => listMistakes(error.path, error.mistakes)),
  )

const serve = Effect.gen(function* () {
  const { ESTATE_SETTINGS } = process.env
  const started = yield* prepare(ESTATE_SETTINGS ?? "/etc/estate/estate.yaml", process.env)
  const database = started.settings.notes?.postgres
  const notes = database === undefined ? memoryNotes : postgresNotes(sqlOf(Redacted.value(database)))
  const provided = services(started, builtWeb, liveRemote, notes, process.env)
  const server = HttpRouter.serve(application).pipe(
    Layer.provide(
      BunHttpServer.layer({ port: started.settings.port ?? 8080, hostname: started.settings.host ?? "0.0.0.0" }),
    ),
  )
  return yield* Effect.all([Layer.launch(server), background(started, process.env)], { concurrency: "unbounded" }).pipe(
    Effect.provide(provided),
  )
}).pipe(
  Effect.catchTags({
    StartError: (error) => listMistakes(error.file, error.mistakes),
    NotesError: (error) => listMistakes("estate.yaml", [{ at: "notes.postgres", message: error.message }]),
  }),
)

const [command, file] = process.argv.slice(2)
BunRuntime.runMain(command === "check" && file !== undefined ? check(file) : serve)
