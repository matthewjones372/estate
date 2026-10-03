/** What the cluster says of each service: its workloads' pods, and its debug level from its logging ConfigMap. */
import { Clock, Effect, Schema } from "effect"
import type { Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Debug, Pod } from "../../shared/events"
import type { Remote } from "../remote"
import type { Workloads } from "../state"
import { jobsOf } from "./jobs"
import { type Cluster, Condition, kube, Metadata } from "./kubernetes"
import type { Failure } from "./run"

const Workload = Schema.Struct({
  spec: Schema.Struct({
    selector: Schema.Struct({ matchLabels: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)) }),
  }),
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

const ConfigMap = Schema.Struct({
  metadata: Metadata,
  data: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

const debugAnnotations = {
  until: "estate.dev/debug-until",
  since: "estate.dev/debug-since",
  by: "estate.dev/debug-by",
  from: "estate.dev/debug-from",
} as const

const plural = { Deployment: "deployments", StatefulSet: "statefulsets", DaemonSet: "daemonsets" } as const

const podsOf = (cluster: Cluster, service: Service): Effect.Effect<ReadonlyArray<Pod>, Failure, Remote> => {
  const kubernetes = service.kubernetes
  if (kubernetes === undefined) return Effect.succeed([])
  const namespace = encodeURIComponent(kubernetes.namespace)
  return Effect.forEach(kubernetes.workloads, (workload) =>
    Effect.gen(function* () {
      const found = yield* kube(
        cluster,
        `/apis/apps/v1/namespaces/${namespace}/${plural[workload.kind]}/${encodeURIComponent(workload.name)}`,
        Workload,
      )
      const selector = Object.entries(found.spec.selector.matchLabels ?? {})
        .map(([name, value]) => `${name}=${value}`)
        .join(",")
      const pods = yield* kube(
        cluster,
        `/api/v1/namespaces/${namespace}/pods?labelSelector=${encodeURIComponent(selector)}`,
        Pods,
      )
      return pods.items.map((pod) =>
        compact({
          name: pod.metadata.name,
          phase: pod.status.phase ?? "Unknown",
          ready: (pod.status.conditions ?? []).some(
            (condition) => condition.type === "Ready" && condition.status === "True",
          ),
          restarts: (pod.status.containerStatuses ?? []).reduce(
            (total, container) => total + container.restartCount,
            0,
          ),
          image: pod.spec.containers[0]?.image,
          node: pod.spec.nodeName,
          startedAt: pod.status.startTime,
        }),
      )
    }),
  ).pipe(Effect.map((each) => each.flat()))
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
  const { debug, kubernetes } = service
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
    const read = yield* Effect.forEach(
      services,
      (service) =>
        Effect.all([podsOf(cluster, service), debugFor(cluster, service), jobsOf(cluster, service, now)]).pipe(
          Effect.map(([pods, debug, jobs]) => ({ service: service.name, pods, debug, jobs })),
        ),
      { concurrency: 4 },
    )
    return {
      pods: Object.fromEntries(read.map((each) => [each.service, each.pods])),
      jobs: Object.fromEntries(read.flatMap((each) => (each.jobs.length === 0 ? [] : [[each.service, each.jobs]]))),
      debug: Object.fromEntries(read.flatMap((each) => (each.debug === undefined ? [] : [[each.service, each.debug]]))),
    }
  })
