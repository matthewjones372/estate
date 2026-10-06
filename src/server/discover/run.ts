/**
 * Discovery every minute, beside the catalog file's reload: each environment read from Kubernetes asked what its
 * rules find, and the catalog shown made again from the written one and all that was found. A cluster that does not
 * answer keeps what it found last.
 */
import { Effect, type FileSystem, Ref } from "effect"
import type { Catalog, Service } from "../../shared/catalog"
import { withCatalog } from "../catalog-file"
import type { Remote } from "../remote"
import { forEver } from "../schedule"
import type { Settings } from "../settings"
import { clusterOf } from "../sources/kubernetes"
import { runtimeOf } from "../sources/ports"
import { type Estate, updateEstate } from "../state"
import { entryOf, together, workloadsIn } from "./kubernetes"
import { checked, shown } from "./merge"

/** The catalog as written, and what each environment's cluster was last found to hold. */
export interface Catalogs {
  readonly written: Ref.Ref<Catalog>
  readonly found: Ref.Ref<Readonly<Record<string, ReadonlyArray<Service>>>>
  /** What was last said about entries left out, so a mistake is logged once, not every minute. */
  readonly said: Ref.Ref<string>
}

export const makeCatalogs = (written: Catalog): Effect.Effect<Catalogs> =>
  Effect.all({ written: Ref.make(written), found: Ref.make({}), said: Ref.make("") })

/** The catalog shown made again; the state is left alone when it comes out the same. */
const publish = (catalogs: Catalogs, settings: Settings): Effect.Effect<void, never, Estate> =>
  Effect.gen(function* () {
    const found = together(Object.values(yield* Ref.get(catalogs.found)).flat())
    const { catalog } = shown(yield* Ref.get(catalogs.written), found)
    yield* updateEstate((estate) =>
      JSON.stringify(estate.catalog) === JSON.stringify(catalog) ? estate : withCatalog(estate, catalog, settings),
    )
  })

/** A written catalog taken from its file, shown with what was found. */
export const written = (catalogs: Catalogs, settings: Settings) => (catalog: Catalog) =>
  Ref.set(catalogs.written, catalog).pipe(Effect.andThen(publish(catalogs, settings)))

/** Each environment's cluster asked once what the rules find there. */
export const discoverOnce = (
  catalogs: Catalogs,
  settings: Settings,
): Effect.Effect<void, never, Estate | Remote | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const catalog = yield* Ref.get(catalogs.written)
    const rules = catalog.discover ?? []
    const leftOut: Array<string> = []
    for (const environment of catalog.environments) {
      const section = settings.sources[environment.sources] ?? {}
      const kubernetes = section.kubernetes
      if (rules.length === 0 || runtimeOf(section) !== "kubernetes" || kubernetes === undefined) {
        yield* Ref.update(catalogs.found, ({ [environment.name]: _, ...rest }) => rest)
        continue
      }
      const asked = yield* Effect.result(
        Effect.flatMap(clusterOf(kubernetes), (cluster) =>
          Effect.forEach(rules, (rule) =>
            Effect.map(workloadsIn(cluster, rule.kubernetes), (workloads) =>
              workloads.map((workload) => entryOf(rule, environment.name, workload)),
            ),
          ),
        ),
      )
      if (asked._tag === "Failure") {
        yield* Effect.logWarning(`services could not be discovered in ${environment.name}: ${asked.failure.message}`)
        continue
      }
      const { kept, leftOut: wrong } = checked(catalog, asked.success.flat())
      leftOut.push(...wrong.map((each) => `${environment.name} ${each.name}: ${each.mistakes[0]?.message ?? ""}`))
      yield* Ref.update(catalogs.found, (found) => ({ ...found, [environment.name]: kept }))
    }
    const saying = leftOut.join("; ")
    if (saying !== (yield* Ref.getAndSet(catalogs.said, saying)) && saying !== "")
      yield* Effect.logWarning(`discovered services left out, each with a mistake: ${saying}`)
    yield* publish(catalogs, settings)
  })

export const discoverServices = (catalogs: Catalogs, settings: Settings) =>
  forEver(discoverOnce(catalogs, settings), "1 minute")
