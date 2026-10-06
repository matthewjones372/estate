/**
 * Estate's entry. `estate check catalog.yaml` checks a catalog for an estate's own CI; anything else serves, with
 * the settings from `ESTATE_SETTINGS` (by default `/etc/estate/estate.yaml`).
 */
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { SQL } from "bun"
import { Config, Console, Effect, Layer, Logger, Redacted, Result } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { Otlp, OtlpSerialization, PrometheusMetrics } from "effect/observability"
import type { Mistake } from "../shared/shape"
import { application, background, prepare, services } from "./app"
import { parseCatalog, readCatalogText } from "./catalog-file"
import { doctor, printed } from "./doctor"
import { clusterFinding } from "./doctor-cluster"
import { memoryNotes, postgresNotes, type Query } from "./notes"
import { dynamodbNotes } from "./notes-dynamodb"
import { platform } from "./platform"
import { liveRemote } from "./remote"
import { clusteredBy } from "./settings-cluster"
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
    Effect.provide(platform),
  )

const serve = Effect.gen(function* () {
  const settingsPath = yield* Config.String("ESTATE_SETTINGS").pipe(
    Config.withDefault("/etc/estate/estate.yaml"),
    Effect.orElseSucceed(() => "/etc/estate/estate.yaml"),
  )
  const started = yield* prepare(settingsPath)
  const { postgres, dynamodb } = started.settings.notes ?? {}
  const notes =
    started.settings.readOnly === true
      ? memoryNotes
      : postgres !== undefined
        ? postgresNotes(sqlOf(Redacted.value(postgres)))
        : dynamodb !== undefined
          ? dynamodbNotes(dynamodb).pipe(Layer.provide([liveRemote, platform]))
          : memoryNotes
  const hostname = started.settings.host ?? "0.0.0.0"
  const server = HttpRouter.serve(application).pipe(
    Layer.provide(BunHttpServer.layer({ port: started.settings.port ?? 8080, hostname })),
  )
  const metrics = HttpRouter.serve(PrometheusMetrics.layerHttp()).pipe(
    Layer.provide(BunHttpServer.layer({ port: started.settings.metrics?.port ?? 9464, hostname })),
  )
  const otlp = started.settings.telemetry?.otlp
  const telemetry =
    otlp === undefined
      ? Layer.empty
      : Otlp.layer({ baseUrl: otlp, resource: { serviceName: "estate" } }).pipe(
          Layer.provide([FetchHttpClient.layer, OtlpSerialization.layerJson]),
        )
  const serving = [Layer.launch(server), Layer.launch(metrics)] as const
  const clustered = clusteredBy(started.settings.cluster)
  if (clustered === undefined || postgres === undefined)
    return yield* Effect.all([...serving, background(started)], { concurrency: "unbounded" }).pipe(
      Effect.provide(services(started, builtWeb, liveRemote, notes)),
      Effect.provide(telemetry),
    )
  // The cluster's modules are loaded only for a cluster; one process never loads them.
  const runner = (yield* Effect.promise(() => import("./cluster/serve"))).asRunner(started, clustered, postgres)
  return yield* Effect.all([...serving, runner.alongside], { concurrency: "unbounded" }).pipe(
    Effect.provide(services(started, builtWeb, liveRemote, notes, runner.holding)),
    Effect.provide(runner.sharding),
    Effect.provide(telemetry),
  )
}).pipe(
  Effect.catchTags({
    StartError: (error) => listMistakes(error.file, error.mistakes),
    NotesError: (error) => listMistakes("estate.yaml", [{ at: "notes", message: error.message }]),
  }),
  Effect.provide(platform),
)

/** Log lines as JSON, for a log store to read, unless ESTATE_LOG_FORMAT=pretty asks for ones a person reads. */
const logs = Layer.unwrap(
  Effect.map(
    Config.Literals(["json", "pretty"], "ESTATE_LOG_FORMAT").pipe(
      Config.withDefault("json"),
      Effect.orElseSucceed(() => "json" as const),
    ),
    (format) => Logger.layer([format === "json" ? Logger.consoleJson : Logger.consolePretty()]),
  ),
)

/** `estate doctor`: each source asked once, and what it said, a part a line; exits 1 if any part failed. */
const diagnose = Effect.gen(function* () {
  const settingsPath = yield* Config.String("ESTATE_SETTINGS").pipe(
    Config.withDefault("/etc/estate/estate.yaml"),
    Effect.orElseSucceed(() => "/etc/estate/estate.yaml"),
  )
  const started = yield* prepare(settingsPath)
  const reports = yield* doctor(started.settings, started.initial.catalog)
  const postgres = started.settings.notes?.postgres
  const clustered = clusteredBy(started.settings.cluster) !== undefined && postgres !== undefined
  const cluster = clustered
    ? [{ environment: "the cluster", findings: [yield* clusterFinding(sqlOf(Redacted.value(postgres)))] }]
    : []
  const { text, ok } = printed([...reports, ...cluster])
  yield* Console.log(text)
  if (!ok) process.exitCode = 1
}).pipe(
  Effect.catchTag("StartError", (error) => listMistakes(error.file, error.mistakes)),
  Effect.provide(Layer.merge(liveRemote, platform)),
)

const [command, file] = process.argv.slice(2)
BunRuntime.runMain(
  command === "check" && file !== undefined
    ? check(file)
    : command === "doctor"
      ? diagnose
      : serve.pipe(Effect.provide(logs)),
)
