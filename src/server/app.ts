/** Estate assembled: settings and catalog read and checked, the routes, the catalog's reload and the sources. */
import { Data, Effect, type FileSystem, Layer, Result } from "effect"
import type { Mistake } from "../shared/shape"
import { CatalogError, configuredKinds, crossCheck, parseCatalog, readCatalogText, reloadCatalog } from "./catalog-file"
import { debugOffRoute, debugOnRoute } from "./http/debug"
import { loadRoute } from "./http/load"
import { loadNotes, notesRoute, removeNoteRoute, sweepNotes } from "./http/notes"
import { routes } from "./http/routes"
import { signInRoutes } from "./http/sign-in"
import { silenceRoute, unsilenceRoute } from "./http/silences"
import { memoryNotes, type Notes } from "./notes"
import { platform, readText } from "./platform"
import type { Remote } from "./remote"
import { backOff } from "./schedule"
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
export const prepare = (settingsPath: string): Effect.Effect<Started, StartError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const settingsText = yield* readText(settingsPath).pipe(
      Effect.mapError(
        () => new StartError({ file: settingsPath, mistakes: [{ at: settingsPath, message: "cannot be read" }] }),
      ),
    )
    const settings = yield* readSettings(settingsText)
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
export const application = Layer.mergeAll(
  routes,
  signInRoutes,
  loadRoute,
  notesRoute,
  removeNoteRoute,
  silenceRoute,
  unsilenceRoute,
  debugOnRoute,
  debugOffRoute,
)

/** What runs beside the routes for as long as Estate does. */
export const background = (
  started: Started,
): Effect.Effect<never, never, Estate | Remote | Notes | FileSystem.FileSystem> =>
  Effect.all(
    [
      loadNotes.pipe(
        Effect.tapError((failure) => Effect.logWarning(`notes cannot be read yet: ${failure.message}`)),
        Effect.retry(backOff),
        Effect.orDie,
        Effect.andThen(Effect.never),
      ),
      sweepNotes(started.settings.notes?.keepDays ?? 30),
      reloadCatalog(started.settings.catalog, started.settings, started.catalogText),
      startSources(started.settings),
    ],
    { concurrency: "unbounded" },
  ).pipe(Effect.andThen(Effect.never))

export const services = <E, F, R>(
  started: Started,
  web: Layer.Layer<Web, E, R>,
  remote: Layer.Layer<Remote>,
  notes: Layer.Layer<Notes, F> = memoryNotes,
) =>
  Layer.mergeAll(estateLayer(started.initial), web, remote, notes, Layer.succeed(Configured)(started.settings)).pipe(
    Layer.provideMerge(platform),
  )
