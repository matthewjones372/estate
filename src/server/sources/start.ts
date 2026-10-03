/** Every environment's sources, each read on its own schedule, for as long as Estate runs. */
import { Clock, Effect, FiberMap, type FileSystem, Stream, SubscriptionRef } from "effect"
import type { Service } from "../../shared/catalog"
import { makeAwsJson } from "../aws/json"
import type { Remote } from "../remote"
import type { Settings } from "../settings"
import { Estate } from "../state"
import { inEnvironment } from "../views/catalog"
import { readAlerts, withResolved } from "./alerts"
import { readArgo } from "./argo"
import { runBuilds } from "./builds"
import { readCluster } from "./cluster"
import { revertExpired } from "./debug"
import { ecsApi, readEcsDeploys, readEcsWorkloads } from "./ecs"
import { readDeploys } from "./flux"
import { grafanaRules } from "./grafana"
import { clusterOf } from "./kubernetes"
import { readMetrics } from "./metrics"
import { alertsOf, buildsOf, deploysOf, metricsOf, runtimeOf } from "./ports"
import { type Failure, runSource } from "./run"

/** The services in an environment as the catalog says now, so a reloaded catalog is read from the next time. */
const servicesIn = (environment: string): Effect.Effect<ReadonlyArray<Service>, never, Estate> =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    return inEnvironment(catalog, environment)
  })

type Environment = { readonly name: string; readonly sources: string }

/** One environment's sources, each read on its own schedule, together. */
const readersFor = (
  settings: Settings,
  environment: Environment,
): Effect.Effect<never, never, Estate | Remote | FileSystem.FileSystem> => {
  const readers: Array<Effect.Effect<never, never, Estate | Remote | FileSystem.FileSystem>> = []
  const section = settings.sources[environment.sources] ?? {}
  if (alertsOf(section).length > 0) {
    readers.push(runSource(environment.name, "alerts", "20 seconds", readAlerts(section), withResolved))
  }
  const { prometheus } = section
  if (metricsOf(section) === "prometheus" && prometheus !== undefined) {
    const url = prometheus.url.replace(/\/$/, "")
    const read = Effect.gen(function* () {
      const estate = yield* SubscriptionRef.get(yield* Estate)
      const firing = estate.environments[environment.name]?.alerts.value ?? []
      const now = yield* Clock.currentTimeMillis
      const here = environment.name
      const stores = (estate.catalog.stores ?? []).filter((store) => store.environments.includes(here))
      const grafana = section.grafana === undefined ? Effect.succeed(new Map()) : grafanaRules(section.grafana)
      return yield* readMetrics(url, grafana, estate.catalog, inEnvironment(estate.catalog, here), stores, firing, now)
    })
    readers.push(runSource(environment.name, "metrics", "30 seconds", read))
  }
  const { argo } = section
  if (deploysOf(section) === "argo" && argo !== undefined) {
    const read = Effect.flatMap(servicesIn(environment.name), (services) => readArgo(argo, services))
    readers.push(runSource(environment.name, "deploys", "30 seconds", read))
  }
  const { aws } = section
  if (runtimeOf(section) === "ecs" && aws !== undefined) {
    // Task definitions never change, so the image each names is asked for once.
    const images = new Map<string, string | undefined>()
    readers.push(
      Effect.flatMap(makeAwsJson(ecsApi, aws.region, aws.endpoint), (ecs) => {
        const read = <A>(part: (services: ReadonlyArray<Service>) => Effect.Effect<A, Failure>) =>
          Effect.flatMap(servicesIn(environment.name), part)
        return Effect.all(
          [
            runSource(
              environment.name,
              "cluster",
              "15 seconds",
              read((services) => readEcsWorkloads(ecs, services)),
            ),
            ...(deploysOf(section) === "ecs"
              ? [
                  runSource(
                    environment.name,
                    "deploys",
                    "30 seconds",
                    read((services) => readEcsDeploys(ecs, services, images)),
                  ),
                ]
              : []),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.andThen(Effect.never))
      }),
    )
  }
  const { kubernetes } = section
  if (runtimeOf(section) === "kubernetes" && kubernetes !== undefined) {
    // The cluster's address and credentials are read again at most once a minute, not for every read.
    const cached = Effect.cachedWithTTL(clusterOf(kubernetes), "1 minute")
    readers.push(
      Effect.flatMap(cached, (cluster) => {
        const withCluster = <A>(
          read: (
            cluster: Parameters<typeof readCluster>[0],
            services: ReadonlyArray<Service>,
          ) => Effect.Effect<A, Failure, Remote>,
        ) =>
          Effect.gen(function* () {
            return yield* read(yield* cluster, yield* servicesIn(environment.name))
          })
        const reading = [
          runSource(environment.name, "cluster", "15 seconds", withCluster(readCluster)),
          ...(deploysOf(section) === "flux"
            ? [runSource(environment.name, "deploys", "30 seconds", withCluster(readDeploys))]
            : []),
          revertExpired(environment.name, cluster),
        ]
        return Effect.all(reading, { concurrency: "unbounded" }).pipe(Effect.andThen(Effect.never))
      }),
    )
  }
  return Effect.all(readers, { concurrency: "unbounded" }).pipe(Effect.andThen(Effect.never))
}

/** An environment's readers are known by its name and the section of the settings it reads. */
const keyOf = (environment: Environment) => `${environment.name}\u0000${environment.sources}`

/**
 * Every environment's sources, for as long as Estate runs: one fiber of readers per environment, started for each
 * environment the catalog gains, stopped for each it loses, and restarted when one changes the sources it reads.
 * GitHub's builds are read once for the whole estate.
 */
export const startSources = (
  settings: Settings,
): Effect.Effect<never, never, Estate | Remote | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<string>()
    const ref = yield* Estate
    const follow = (environments: ReadonlyArray<Environment>) =>
      Effect.gen(function* () {
        const wanted = new Map(environments.map((environment) => [keyOf(environment), environment]))
        const running = [...fibers].map(([key]) => key)
        for (const key of running) if (!wanted.has(key)) yield* FiberMap.remove(fibers, key)
        for (const [key, environment] of wanted)
          yield* FiberMap.run(fibers, key, readersFor(settings, environment), { onlyIfMissing: true })
      })
    yield* follow((yield* SubscriptionRef.get(ref)).catalog.environments)
    if (settings.builds !== undefined && buildsOf(settings).length > 0)
      yield* Effect.forkScoped(runBuilds(settings.builds))
    return yield* SubscriptionRef.changes(ref).pipe(
      Stream.map((estate) => estate.catalog.environments),
      Stream.changes,
      Stream.runForEach(follow),
      Effect.andThen(Effect.never),
    )
  }).pipe(Effect.scoped)
