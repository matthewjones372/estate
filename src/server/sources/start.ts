/** Every environment's sources, each read on its own schedule, for as long as Estate runs. */
import { Clock, Effect, FiberMap, type FileSystem, Stream, SubscriptionRef } from "effect"
import type { Service, StandaloneJob } from "../../shared/catalog"
import { makeAwsJson } from "../aws/json"
import type { Remote } from "../remote"
import type { Settings } from "../settings"
import { Estate, updateEnvironment } from "../state"
import { agentsIn, inEnvironment, jobsIn } from "../views/catalog"
import { priced, withModels } from "./agents"
import { readAlerts, withResolved } from "./alerts"
import { readArgo } from "./argo"
import { runBuilds } from "./builds"
import { cloudwatchApi, readAlarms } from "./cloudwatch"
import { readCluster } from "./cluster"
import { costsReader } from "./costs"
import { alertsBeside } from "./datadog"
import { revertExpired } from "./debug"
import { ecsApi, readEcsDeploys, readEcsWorkloads } from "./ecs"
import { buildsEvery, everyOf } from "./every"
import { readDeploys } from "./flux"
import { readHarnessDeploys } from "./harness"
import { keepHeld } from "./held"
import { clusterOf } from "./kubernetes"
import { chartsOf, readMetrics } from "./metrics"
import { alertsOf, buildsOf, deploysOf, runtimeOf } from "./ports"
import type { Ranges } from "./prometheus"
import { rangesIn } from "./ranges"
import { type Failure, runSource } from "./run"
import { ecsJobs, kubernetesJobs, withJobs } from "./standalone"

/** The services in an environment as the catalog says now, so a reloaded catalog is read from the next time. */
const servicesIn = (environment: string): Effect.Effect<ReadonlyArray<Service>, never, Estate> =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    return inEnvironment(catalog, environment)
  })

/** What the cluster is asked about: the services, and each agent that names where it runs, as a service would. */
const workloadsIn = (environment: string): Effect.Effect<ReadonlyArray<Service>, never, Estate> =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const agents = agentsIn(catalog, environment).flatMap((agent) => {
      const kubernetes = agent.runtime?.kubernetes
      return kubernetes === undefined ? [] : [{ name: agent.name, environments: agent.environments, kubernetes }]
    })
    return [...inEnvironment(catalog, environment), ...agents]
  })

/** The jobs no service owns in an environment, as the catalog says now. */
const jobsHere = (environment: string): Effect.Effect<ReadonlyArray<StandaloneJob>, never, Estate> =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    return jobsIn(catalog, environment)
  })

type Environment = { readonly name: string; readonly sources: string }

/**
 * Charts for alerts as they start firing, rather than at the next read of the metrics: whenever the environment's
 * firing alerts include ones without a chart, those are read and added to the metrics it has.
 */
const chartNewlyFiring = (environment: string, ranges: Ranges): Effect.Effect<never, never, Estate | Remote> =>
  Effect.gen(function* () {
    const ref = yield* Estate
    yield* SubscriptionRef.changes(ref).pipe(
      Stream.map((estate) => {
        const state = estate.environments[environment]
        const charted = state?.metrics.value?.charts ?? {}
        return (state?.alerts.value ?? []).filter(
          (alert) => alert.state === "firing" && charted[alert.id] === undefined,
        )
      }),
      Stream.filter((uncharted) => uncharted.length > 0),
      Stream.changesWith((a, b) => a.map((alert) => alert.id).join() === b.map((alert) => alert.id).join()),
      Stream.runForEach((uncharted) =>
        Effect.gen(function* () {
          const rules = yield* ranges.rules.pipe(Effect.orElseSucceed(() => new Map<string, string>()))
          const charts = yield* chartsOf(ranges, rules, uncharted, yield* Clock.currentTimeMillis)
          yield* updateEnvironment(environment, (state) =>
            state.metrics.value === undefined
              ? state
              : {
                  ...state,
                  metrics: {
                    ...state.metrics,
                    value: { ...state.metrics.value, charts: { ...state.metrics.value.charts, ...charts } },
                  },
                },
          )
        }),
      ),
    )
    return yield* Effect.never
  })

/** Done once the environment's alerts have been read, whether they answered or failed. */
const alertsHeard = (environment: string): Effect.Effect<void, never, Estate> =>
  Effect.gen(function* () {
    const ref = yield* Estate
    yield* SubscriptionRef.changes(ref).pipe(
      Stream.filter((estate) => {
        const state = estate.environments[environment]?.alerts.state
        return state === "ok" || state === "failing"
      }),
      Stream.take(1),
      Stream.runDrain,
    )
  })

/** One environment's sources, each read on its own schedule, together. */
const readersFor = (
  settings: Settings,
  environment: Environment,
): Effect.Effect<never, never, Estate | Remote | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const readers: Array<Effect.Effect<never, never, Estate | Remote | FileSystem.FileSystem>> = []
    const section = settings.sources[environment.sources] ?? {}
    const { aws } = section
    const ecs = aws === undefined ? undefined : yield* makeAwsJson(ecsApi, aws.region, aws.endpoint)
    const cloudwatch = aws === undefined ? undefined : yield* makeAwsJson(cloudwatchApi, aws.region, aws.endpoint)
    if (alertsOf(section).length > 0) {
      const alarms = alertsBeside(cloudwatch === undefined ? undefined : readAlarms(cloudwatch), section.datadog)
      readers.push(
        runSource(
          environment.name,
          "alerts",
          everyOf(section, "alerts"),
          readAlerts(section, alarms),
          (before, after, alerts, at) => keepHeld(withResolved(before, after, alerts, at), at),
        ),
      )
    }
    const costs = yield* costsReader(section, environment.name)
    if (costs !== undefined) readers.push(runSource(environment.name, "costs", everyOf(section, "costs"), costs))
    const ranges = yield* rangesIn(section)
    if (ranges !== undefined) {
      const read = Effect.gen(function* () {
        const estate = yield* SubscriptionRef.get(yield* Estate)
        const firing = estate.environments[environment.name]?.alerts.value ?? []
        const now = yield* Clock.currentTimeMillis
        const here = environment.name
        const stores = (estate.catalog.stores ?? []).filter((store) => store.environments.includes(here))
        const services = inEnvironment(estate.catalog, here)
        const metrics = yield* readMetrics(
          ranges,
          estate.catalog,
          services,
          stores,
          firing,
          now,
          agentsIn(estate.catalog, here),
        )
        return priced(metrics, settings.prices)
      })
      readers.push(chartNewlyFiring(environment.name, ranges))
      // The first read waits a little for the alerts, so those firing as Estate starts are charted on it.
      readers.push(
        Effect.andThen(
          alertsHeard(environment.name).pipe(Effect.timeout("10 seconds"), Effect.ignore),
          runSource(environment.name, "metrics", everyOf(section, "metrics"), read, withModels),
        ),
      )
    }
    const { argo } = section
    if (deploysOf(section) === "argo" && argo !== undefined) {
      const read = Effect.flatMap(servicesIn(environment.name), (services) => readArgo(argo, services))
      readers.push(runSource(environment.name, "deploys", everyOf(section, "deploys"), read))
    }
    const { harness } = section
    if (deploysOf(section) === "harness" && harness !== undefined) {
      const read = Effect.flatMap(servicesIn(environment.name), (services) =>
        readHarnessDeploys(harness, services, environment.name),
      )
      readers.push(runSource(environment.name, "deploys", everyOf(section, "deploys"), read))
    }
    if (runtimeOf(section) === "ecs" && ecs !== undefined) {
      // Task definitions never change, so the image each names is asked for once.
      const images = new Map<string, string | undefined>()
      const read = <A>(part: (services: ReadonlyArray<Service>) => Effect.Effect<A, Failure, Estate>) =>
        Effect.flatMap(servicesIn(environment.name), part)
      readers.push(
        Effect.all(
          [
            runSource(
              environment.name,
              "cluster",
              everyOf(section, "cluster"),
              read((services) =>
                Effect.all([
                  readEcsWorkloads(ecs, services),
                  Effect.flatMap(jobsHere(environment.name), (jobs) => ecsJobs(ecs, jobs)),
                ]).pipe(Effect.map(([workloads, jobs]) => withJobs(workloads, jobs))),
              ),
            ),
            ...(deploysOf(section) === "ecs"
              ? [
                  runSource(
                    environment.name,
                    "deploys",
                    everyOf(section, "deploys"),
                    read((services) => readEcsDeploys(ecs, services, images)),
                  ),
                ]
              : []),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.andThen(Effect.never)),
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
            ) => Effect.Effect<A, Failure, Remote | Estate>,
          ) =>
            Effect.gen(function* () {
              return yield* read(yield* cluster, yield* workloadsIn(environment.name))
            })
          const reading = [
            runSource(
              environment.name,
              "cluster",
              everyOf(section, "cluster"),
              withCluster((cluster, services) =>
                Effect.gen(function* () {
                  const jobs = yield* jobsHere(environment.name)
                  const now = yield* Clock.currentTimeMillis
                  const [workloads, standalone] = yield* Effect.all(
                    [readCluster(cluster, services), kubernetesJobs(cluster, jobs, now)],
                    { concurrency: 2 },
                  )
                  return withJobs(workloads, standalone)
                }),
              ),
            ),
            ...(deploysOf(section) === "flux"
              ? [runSource(environment.name, "deploys", everyOf(section, "deploys"), withCluster(readDeploys))]
              : []),
            ...(settings.readOnly === true ? [] : [revertExpired(environment.name, cluster)]),
          ]
          return Effect.all(reading, { concurrency: "unbounded" }).pipe(Effect.andThen(Effect.never))
        }),
      )
    }
    return yield* Effect.all(readers, { concurrency: "unbounded" }).pipe(Effect.andThen(Effect.never))
  })

/** An environment's readers are known by its name and the section of the settings it reads. */
const keyOf = (environment: Environment) => `${environment.name}\u0000${environment.sources}`

/**
 * Every environment's sources, for as long as Estate runs: one fiber of readers per environment, started for each
 * environment the catalog gains, stopped for each it loses, and restarted when one changes the sources it reads.
 * GitHub's builds are read once for the whole estate.
 */
export const startSources = (
  settings: Settings,
  /** Which of it to read, when a cluster has the estate's work and each environment's on different runners. */
  scope: { readonly environments: (name: string) => boolean; readonly builds: boolean } = {
    environments: () => true,
    builds: true,
  },
): Effect.Effect<never, never, Estate | Remote | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fibers = yield* FiberMap.make<string>()
    const ref = yield* Estate
    const follow = (environments: ReadonlyArray<Environment>) =>
      Effect.gen(function* () {
        const wanted = new Map(
          environments
            .filter((environment) => scope.environments(environment.name))
            .map((environment) => [keyOf(environment), environment]),
        )
        const running = [...fibers].map(([key]) => key)
        for (const key of running) if (!wanted.has(key)) yield* FiberMap.remove(fibers, key)
        for (const [key, environment] of wanted)
          yield* FiberMap.run(fibers, key, readersFor(settings, environment), { onlyIfMissing: true })
      })
    yield* follow((yield* SubscriptionRef.get(ref)).catalog.environments)
    if (scope.builds && settings.builds !== undefined && buildsOf(settings).length > 0)
      yield* Effect.forkScoped(runBuilds(settings.builds, buildsEvery(settings.builds)))
    return yield* SubscriptionRef.changes(ref).pipe(
      Stream.map((estate) => estate.catalog.environments),
      Stream.changes,
      Stream.runForEach(follow),
      Effect.andThen(Effect.never),
    )
  }).pipe(Effect.scoped)
