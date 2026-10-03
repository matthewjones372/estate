/** Every environment's sources, each read on its own schedule, for as long as Estate runs. */
import { Clock, Effect, SubscriptionRef } from "effect"
import type { Service } from "../../shared/catalog"
import type { Remote } from "../remote"
import type { Settings } from "../settings"
import { Estate } from "../state"
import { inEnvironment } from "../views/catalog"
import { readAlerts, withResolved } from "./alerts"
import { readCluster } from "./cluster"
import { readDeploys } from "./flux"
import { runBuilds } from "./github"
import { clusterOf } from "./kubernetes"
import { readMetrics } from "./metrics"
import { type Failure, runSource } from "./run"

/** The services in an environment as the catalog says now, so a reloaded catalog is read from the next time. */
const servicesIn = (environment: string): Effect.Effect<ReadonlyArray<Service>, never, Estate> =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    return inEnvironment(catalog, environment)
  })

export const startSources = (
  settings: Settings,
  environments: ReadonlyArray<{ readonly name: string; readonly sources: string }>,
  host: Readonly<Record<string, string | undefined>>,
): Effect.Effect<never, never, Estate | Remote> =>
  Effect.gen(function* () {
    const readers: Array<Effect.Effect<never, never, Estate | Remote>> = []
    for (const environment of environments) {
      const section = settings.sources[environment.sources] ?? {}
      if (section.alertmanager !== undefined || section.prometheus !== undefined) {
        readers.push(runSource(environment.name, "alerts", "20 seconds", readAlerts(section), withResolved))
      }
      const { prometheus } = section
      if (prometheus !== undefined) {
        const url = prometheus.url.replace(/\/$/, "")
        const read = Effect.gen(function* () {
          const estate = yield* SubscriptionRef.get(yield* Estate)
          const firing = estate.environments[environment.name]?.alerts.value ?? []
          const now = yield* Clock.currentTimeMillis
          return yield* readMetrics(url, estate.catalog, inEnvironment(estate.catalog, environment.name), firing, now)
        })
        readers.push(runSource(environment.name, "metrics", "30 seconds", read))
      }
      const { kubernetes } = section
      if (kubernetes !== undefined) {
        const withCluster = <A>(
          read: (
            cluster: Parameters<typeof readCluster>[0],
            services: ReadonlyArray<Service>,
          ) => Effect.Effect<A, Failure, Remote>,
        ) =>
          Effect.gen(function* () {
            const cluster = yield* clusterOf(kubernetes, host)
            return yield* read(cluster, yield* servicesIn(environment.name))
          })
        readers.push(runSource(environment.name, "cluster", "15 seconds", withCluster(readCluster)))
        if (section.flux !== undefined)
          readers.push(runSource(environment.name, "deploys", "30 seconds", withCluster(readDeploys)))
      }
    }
    if (settings.builds !== undefined) readers.push(runBuilds(settings.builds.github))
    return yield* Effect.all(readers, { concurrency: "unbounded" }).pipe(Effect.andThen(Effect.never))
  })
