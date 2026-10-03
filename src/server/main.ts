/**
 * Estate's entry. `estate check catalog.yaml` checks a catalog for an estate's own CI; anything else serves, with
 * the settings from `ESTATE_SETTINGS` (by default `/etc/estate/estate.yaml`).
 */
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Console, Effect, Layer, Result } from "effect"
import { HttpRouter } from "effect/http"
import type { Mistake } from "../shared/shape"
import { application, background, prepare, services } from "./app"
import { parseCatalog, readCatalogText } from "./catalog-file"
import { liveRemote } from "./remote"
import { builtWeb } from "./web"

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
  const provided = services(started, builtWeb, liveRemote)
  const server = HttpRouter.serve(application).pipe(
    Layer.provide(
      BunHttpServer.layer({ port: started.settings.port ?? 8080, hostname: started.settings.host ?? "0.0.0.0" }),
    ),
  )
  return yield* Effect.all([Layer.launch(server), background(started)], { concurrency: "unbounded" }).pipe(
    Effect.provide(provided),
  )
}).pipe(Effect.catchTag("StartError", (error) => listMistakes(error.file, error.mistakes)))

const [command, file] = process.argv.slice(2)
BunRuntime.runMain(command === "check" && file !== undefined ? check(file) : serve)
