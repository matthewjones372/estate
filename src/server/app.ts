/** Estate assembled: settings and catalog read and checked, the routes, the catalog's reload and the sources. */
import { Data, Effect, Layer, Result } from "effect"
import type { Mistake } from "../shared/shape"
import { CatalogError, configuredKinds, crossCheck, parseCatalog, readCatalogText, reloadCatalog } from "./catalog-file"
import { loadRoute } from "./http/load"
import { routes } from "./http/routes"
import { signInRoutes } from "./http/sign-in"
import type { Remote } from "./remote"
import { Configured, readSettings, type Settings, type SettingsError } from "./settings"
import { startSources } from "./sources/start"
import { type Estate, type EstateState, emptyEnvironment, estateLayer, off, waiting } from "./state"
import type { Web } from "./web"

export const StartError = Data.TaggedError("StartError")<{
  readonly file: string
  readonly mistakes: ReadonlyArray<Mistake>
}>
export type StartError = InstanceType<typeof StartError>

export interface Started {
  readonly settings: Settings
  readonly initial: EstateState
  readonly catalogText: string
}

/** Reads both files and checks them, naming every mistake before anything starts. */
export const prepare = (
  settingsPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<Started, StartError> =>
  Effect.gen(function* () {
    const settingsText = yield* Effect.tryPromise({
      try: () => Bun.file(settingsPath).text(),
      catch: () => new StartError({ file: settingsPath, mistakes: [{ at: settingsPath, message: "cannot be read" }] }),
    })
    const settings = yield* readSettings(settingsText, environment)
    const catalogText = yield* readCatalogText(settings.catalog)
    const parsed = parseCatalog(settings.catalog, catalogText)
    if (Result.isFailure(parsed)) return yield* parsed.failure
    const catalog = parsed.success
    const mistakes = crossCheck(settings, catalog)
    if (mistakes.length > 0) return yield* new CatalogError({ path: settings.catalog, mistakes })
    const initial: EstateState = {
      catalog,
      environments: Object.fromEntries(
        catalog.environments.map((each) => [each.name, emptyEnvironment(configuredKinds(settings, each.sources))]),
      ),
      builds: settings.builds === undefined ? off : waiting,
      notes: [],
    }
    return { settings, initial, catalogText }
  }).pipe(
    Effect.catchTags({
      SettingsError: (error: SettingsError) =>
        Effect.fail(new StartError({ file: settingsPath, mistakes: error.mistakes })),
      CatalogError: (error: CatalogError) =>
        Effect.fail(new StartError({ file: error.path, mistakes: error.mistakes })),
    }),
  )

/** The routes with what they need, for serving or for a test's web handler. */
export const application = Layer.mergeAll(routes, signInRoutes, loadRoute)

/** What runs beside the routes for as long as Estate does. */
export const background = (
  started: Started,
  host: Readonly<Record<string, string | undefined>>,
): Effect.Effect<never, never, Estate | Remote> =>
  Effect.all(
    [
      reloadCatalog(started.settings.catalog, started.settings, started.catalogText),
      startSources(started.settings, started.initial.catalog.environments, host),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.andThen(Effect.never))

export const services = <E>(started: Started, web: Layer.Layer<Web, E>, remote: Layer.Layer<Remote>) =>
  Layer.mergeAll(estateLayer(started.initial), web, remote, Layer.succeed(Configured)(started.settings))
