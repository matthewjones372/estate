/** What the cluster says of each service: its workloads' pods, and its debug level from its logging ConfigMap. */
import { Clock, Effect, Schema } from "effect"
import { kubernetesOf, type Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Debug, Pod } from "../../shared/events"
import type { Remote } from "../remote"
import type { Workloads } from "../state"
import { debugAnnotations } from "./debug"
import { jobsOf } from "./jobs"
import { type Cluster, Condition, kube, Metadata } from "./kubernetes"
import type { Failure } from "./run"

const WorkloadList = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      metadata: Metadata,
      spec: Schema.Struct({
        selector: Schema.Struct({ matchLabels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }),
      }),
    }),
  ),
})

const Pods = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      metadata: Metadata,
      spec: Schema.Struct({
        nodeName: Schema.optionalKey(Schema.String),
        containers: Schema.Array(Schema.Struct({ image: Schema.String })),
      }),
      status: Schema.Struct({
        phase: Schema.optionalKey(Schema.String),
        startTime: Schema.optionalKey(Schema.String),
        conditions: Schema.optionalKey(Schema.Array(Condition)),
        containerStatuses: Schema.optionalKey(Schema.Array(Schema.Struct({ restartCount: Schema.Number }))),
      }),
    }),
  ),
})
type PodItem = (typeof Pods.Type)["items"][number]

const ConfigMap = Schema.Struct({
  metadata: Metadata,
  data: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

const plural = { Deployment: "deployments", StatefulSet: "statefulsets", DaemonSet: "daemonsets" } as const
type Kind = keyof typeof plural

/** A namespace as one read sees it: each listed workload's selector by kind and name, and every pod in it. */
interface Listing {
  readonly selectors: ReadonlyMap<string, Readonly<Record<string, string>>>
  readonly pods: ReadonlyArray<PodItem>
}

/** The namespace's workloads of `kinds` and its pods, a list each, however many services live there. */
const listingOf = (
  cluster: Cluster,
  namespace: string,
  kinds: ReadonlySet<Kind>,
): Effect.Effect<Listing, Failure, Remote> => {
  const path = `/namespaces/${encodeURIComponent(namespace)}`
  return Effect.all(
    [
      Effect.forEach([...kinds], (kind) =>
        kube(cluster, `/apis/apps/v1${path}/${plural[kind]}`, WorkloadList).pipe(
          Effect.map((listed) =>
            listed.items.map(
              (item) => [`${kind}/${item.metadata.name}`, item.spec.selector.matchLabels ?? {}] as const,
            ),
          ),
        ),
      ),
      kube(cluster, `/api/v1${path}/pods`, Pods),
    ],
    { concurrency: 2 },
  ).pipe(Effect.map(([selectors, pods]) => ({ selectors: new Map(selectors.flat()), pods: pods.items })))
}

const podOf = (pod: PodItem): Pod =>
  compact({
    name: pod.metadata.name,
    phase: pod.status.phase ?? "Unknown",
    ready: (pod.status.conditions ?? []).some((condition) => condition.type === "Ready" && condition.status === "True"),
    restarts: (pod.status.containerStatuses ?? []).reduce((total, container) => total + container.restartCount, 0),
    image: pod.spec.containers[0]?.image,
    node: pod.spec.nodeName,
    startedAt: pod.status.startTime,
  })

/** The service's pods in a listing: those its workloads select. A workload that is not there selects none. */
const podsIn = (listing: Listing, service: Service): ReadonlyArray<Pod> =>
  (kubernetesOf(service)?.workloads ?? []).flatMap((workload) => {
    const selector = listing.selectors.get(`${workload.kind}/${workload.name}`)
    if (selector === undefined || Object.keys(selector).length === 0) return []
    return listing.pods
      .filter((pod) => Object.entries(selector).every(([name, value]) => pod.metadata.labels?.[name] === value))
      .map(podOf)
  })

const kindsOf = (services: ReadonlyArray<Service>): ReadonlySet<Kind> =>
  new Set(services.flatMap((service) => (kubernetesOf(service)?.workloads ?? []).map((workload) => workload.kind)))

/** One service's pods, its namespace listed for it. */
export const podsOf = (cluster: Cluster, service: Service): Effect.Effect<ReadonlyArray<Pod>, Failure, Remote> => {
  const kubernetes = kubernetesOf(service)
  if (kubernetes === undefined) return Effect.succeed([])
  return Effect.map(listingOf(cluster, kubernetes.namespace, kindsOf([service])), (listing) => podsIn(listing, service))
}

/** A service's debug as its ConfigMap says: on while its level is not the usual one and its time has not passed. */
export const debugOf = (
  levels: ReadonlyArray<string>,
  data: Readonly<Record<string, string>>,
  key: string,
  annotations: Readonly<Record<string, string>>,
): Debug => {
  const usual = levels[0] ?? "INFO"
  const level = data[key] ?? usual
  const { [debugAnnotations.until]: until, [debugAnnotations.since]: since, [debugAnnotations.by]: by } = annotations
  return compact({ level, on: level !== usual, until, since, by })
}

const debugFor = (cluster: Cluster, service: Service): Effect.Effect<Debug | undefined, Failure, Remote> => {
  const { debug } = service
  const kubernetes = kubernetesOf(service)
  if (debug === undefined || kubernetes === undefined) return Effect.succeed(undefined)
  return kube(
    cluster,
    `/api/v1/namespaces/${encodeURIComponent(kubernetes.namespace)}/configmaps/${encodeURIComponent(debug.configMap)}`,
    ConfigMap,
  ).pipe(Effect.map((map) => debugOf(debug.levels, map.data ?? {}, debug.key, map.metadata.annotations ?? {})))
}

/** Every service's pods, jobs and debug, read side by side. */
export const readCluster = (
  cluster: Cluster,
  services: ReadonlyArray<Service>,
): Effect.Effect<Workloads, Failure, Remote> =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    // Each namespace is listed once, whatever number of services live in it.
    const namespaces = [...new Set(services.flatMap((service) => kubernetesOf(service)?.namespace ?? []))]
    const listings = new Map(
      yield* Effect.forEach(
        namespaces,
        (namespace) =>
          Effect.map(
            listingOf(
              cluster,
              namespace,
              kindsOf(services.filter((service) => kubernetesOf(service)?.namespace === namespace)),
            ),
            (listing) => [namespace, listing] as const,
          ),
        { concurrency: 4 },
      ),
    )
    const read = yield* Effect.forEach(
      services,
      (service) => {
        const listing = listings.get(kubernetesOf(service)?.namespace ?? "")
        return Effect.all([debugFor(cluster, service), jobsOf(cluster, service, now)]).pipe(
          Effect.map(([debug, jobs]) => ({
            service: service.name,
            pods: listing === undefined ? [] : podsIn(listing, service),
            debug,
            jobs,
          })),
        )
      },
      { concurrency: 4 },
    )
    return {
      pods: Object.fromEntries(read.map((each) => [each.service, each.pods])),
      jobs: Object.fromEntries(read.flatMap((each) => (each.jobs.length === 0 ? [] : [[each.service, each.jobs]]))),
      debug: Object.fromEntries(read.flatMap((each) => (each.debug === undefined ? [] : [[each.service, each.debug]]))),
    }
  })
