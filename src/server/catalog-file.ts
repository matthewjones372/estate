/** The catalog file: read and checked as Estate starts, then read again every few seconds and taken when it changes. */
import { Data, Duration, Effect, type FileSystem, Ref, Result } from "effect"
import type { Catalog } from "../shared/catalog"
import { checkCatalog } from "../shared/check"
import type { SourceKind } from "../shared/events"
import type { Mistake } from "../shared/shape"
import { readText } from "./platform"
import { forEver } from "./schedule"
import type { Settings } from "./settings"
import { alertsOf, deploysOf, metricsOf, runtimeOf, toolsOf } from "./sources/ports"
import { type Estate, type EstateState, emptyEnvironment, updateEstate } from "./state"

export const CatalogError = Data.TaggedError("CatalogError")<{
  readonly path: string
  readonly mistakes: ReadonlyArray<Mistake>
}>
export type CatalogError = InstanceType<typeof CatalogError>

export const parseCatalog = (path: string, text: string): Result.Result<Catalog, CatalogError> => {
  const fail = (mistakes: ReadonlyArray<Mistake>) => Result.fail(new CatalogError({ path, mistakes }))
  const parsed = Result.try(() => Bun.YAML.parse(text))
  if (Result.isFailure(parsed)) return fail([{ at: path, message: `is not YAML: ${String(parsed.failure)}` }])
  const checked = checkCatalog(parsed.success)
  return Result.isFailure(checked) ? fail(checked.failure) : Result.succeed(checked.success)
}

export const readCatalogText = (path: string): Effect.Effect<string, CatalogError, FileSystem.FileSystem> =>
  readText(path).pipe(
    Effect.mapError(() => new CatalogError({ path, mistakes: [{ at: path, message: "cannot be read" }] })),
  )

/** The kinds of source an environment's section of the settings configures. */
export const configuredKinds = (settings: Settings, sources: string): ReadonlySet<SourceKind> => {
  const section = settings.sources[sources] ?? {}
  return new Set<SourceKind>([
    ...(metricsOf(section) === undefined ? [] : ["metrics" as const]),
    ...(alertsOf(section).length === 0 ? [] : ["alerts" as const]),
    ...(runtimeOf(section) === undefined ? [] : ["cluster" as const]),
    ...(deploysOf(section) === undefined ? [] : ["deploys" as const]),
  ])
}

/** Mistakes between the catalog and the settings: an environment whose sources are not configured. */
export const crossCheck = (settings: Settings, catalog: Catalog): ReadonlyArray<Mistake> =>
  catalog.environments.flatMap((environment, index) =>
    settings.sources[environment.sources] === undefined
      ? [
          {
            at: `environments[${index}] (${environment.name}).sources`,
            message: `"${environment.sources}" is not in estate.yaml's sources`,
          },
        ]
      : [],
  )

/** The estate with a new catalog: environments it adds start waiting, environments it drops are forgotten. */
export const withCatalog = (estate: EstateState, catalog: Catalog, settings: Settings): EstateState => ({
  ...estate,
  catalog,
  environments: Object.fromEntries(
    catalog.environments.map((environment) => [
      environment.name,
      estate.environments[environment.name] ??
        emptyEnvironment(
          configuredKinds(settings, environment.sources),
          toolsOf(settings, settings.sources[environment.sources] ?? {}),
        ),
    ]),
  ),
})

const every = Duration.seconds(10)

/** Takes each change to the catalog file that checks out; a change that does not is logged and left alone. */
export const reloadCatalog = (
  path: string,
  settings: Settings,
  firstText: string,
  taken: (catalog: Catalog) => Effect.Effect<void, never, Estate> = (catalog) =>
    updateEstate((estate) => withCatalog(estate, catalog, settings)),
): Effect.Effect<never, never, Estate | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const last = yield* Ref.make(firstText)
    const reload = Effect.gen(function* () {
      const text = yield* readCatalogText(path)
      if (text === (yield* Ref.get(last))) return
      yield* Ref.set(last, text)
      const parsed = parseCatalog(path, text)
      const mistakes = Result.isFailure(parsed) ? parsed.failure.mistakes : crossCheck(settings, parsed.success)
      if (Result.isSuccess(parsed) && mistakes.length === 0) {
        yield* taken(parsed.success)
        yield* Effect.logInfo(`catalog reloaded from ${path}`)
      } else {
        yield* Effect.logWarning(
          `catalog at ${path} changed but has mistakes, so the last good one stays:\n${mistakes.map((each) => `  ${each.at}: ${each.message}`).join("\n")}`,
        )
      }
    }).pipe(Effect.catch((error) => Effect.logWarning(`catalog at ${error.path} cannot be read`)))
    return yield* forEver(reload, every)
  })
