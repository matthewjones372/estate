/**
 * Debug logging through a service's ConfigMap: the debug level written with when it ends, since when and by whom
 * beside it, and the usual level put back when that time passes. Everything is on the ConfigMap, so Estate restarting
 * loses nothing.
 */
import { Duration, Effect, Schedule, SubscriptionRef } from "effect"
import type { Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Debug } from "../../shared/events"
import { Remote } from "../remote"
import { Estate, updateEnvironment } from "../state"
import { after, iso, isoNow } from "../time"
import { inEnvironment } from "../views/catalog"
import type { Cluster } from "./kubernetes"
import { type Failure, SourceFailure } from "./run"

export const debugAnnotations = {
  until: "estate.dev/debug-until",
  since: "estate.dev/debug-since",
  by: "estate.dev/debug-by",
} as const

export interface Acting {
  readonly name: string
  readonly groups: ReadonlyArray<string>
}

/** Writes `level` to the service's ConfigMap, the annotations beside it, as Estate or as the person acting. */
const patch = (
  cluster: Cluster,
  service: Service,
  level: string,
  annotations: Readonly<Record<string, string | null>>,
  acting?: Acting,
) =>
  Effect.gen(function* () {
    const { debug, kubernetes } = service
    if (debug === undefined || kubernetes === undefined)
      return yield* new SourceFailure({ message: `the catalog names no log level for ${service.name}` })
    const remote = yield* Remote
    const impersonation =
      acting === undefined
        ? {}
        : {
            "impersonate-user": acting.name,
            ...(acting.groups.length === 0 ? {} : { "impersonate-group": acting.groups.join(",") }),
          }
    const answered = yield* remote
      .call({
        url: `${cluster.url}/api/v1/namespaces/${encodeURIComponent(kubernetes.namespace)}/configmaps/${encodeURIComponent(debug.configMap)}`,
        method: "PATCH",
        headers: { ...cluster.headers, ...impersonation, "content-type": "application/merge-patch+json" },
        body: JSON.stringify({ metadata: { annotations }, data: { [debug.key]: level } }),
        ...(cluster.ca === undefined ? {} : { ca: cluster.ca }),
      })
      .pipe(Effect.mapError((error): Failure => new SourceFailure({ message: `the cluster ${error.message}` })))
    if (answered.status !== 200)
      return yield* new SourceFailure({
        message: `the cluster answered ${answered.status}: ${answered.text.slice(0, 200)}`,
      })
  })

/** Debug on for `minutes`: the catalog's last level, until then, under the name of whoever asked. */
export const switchOn = (
  cluster: Cluster,
  service: Service,
  minutes: number,
  by: string,
  now: number,
  acting?: Acting,
): Effect.Effect<Debug, Failure, Remote> => {
  const levels = service.debug?.levels ?? []
  const level = levels.at(-1) ?? "DEBUG"
  const since = iso(now)
  const until = iso(after(now, Duration.minutes(minutes)))
  return patch(
    cluster,
    service,
    level,
    { [debugAnnotations.until]: until, [debugAnnotations.since]: since, [debugAnnotations.by]: by },
    acting,
  ).pipe(Effect.as({ level, on: true, until, since, by }))
}

/** The usual level back, and the annotations gone. */
export const switchOff = (
  cluster: Cluster,
  service: Service,
  acting?: Acting,
): Effect.Effect<Debug, Failure, Remote> => {
  const level = service.debug?.levels[0] ?? "INFO"
  return patch(
    cluster,
    service,
    level,
    { [debugAnnotations.until]: null, [debugAnnotations.since]: null, [debugAnnotations.by]: null },
    acting,
  ).pipe(Effect.as(compact({ level, on: false })))
}

/** Shows a service's new debug on the page at once, before the cluster is next read. */
export const showDebug = (environment: string, service: string, debug: Debug) =>
  updateEnvironment(environment, (state) =>
    state.cluster.value === undefined
      ? state
      : {
          ...state,
          cluster: {
            ...state.cluster,
            value: { ...state.cluster.value, debug: { ...state.cluster.value.debug, [service]: debug } },
          },
        },
  )

/** Every minute, puts back the usual level wherever debug's time has passed. */
export const revertExpired = (
  environment: string,
  cluster: Effect.Effect<Cluster, Failure>,
): Effect.Effect<never, never, Estate | Remote> => {
  const once = Effect.gen(function* () {
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const now = yield* isoNow
    const debug = estate.environments[environment]?.cluster.value?.debug ?? {}
    const expired = inEnvironment(estate.catalog, environment).filter((service) => {
      const until = debug[service.name]?.until
      return debug[service.name]?.on === true && until !== undefined && until <= now
    })
    if (expired.length === 0) return
    const reached = yield* cluster
    for (const service of expired) {
      const off = yield* switchOff(reached, service)
      yield* showDebug(environment, service.name, off)
      yield* Effect.logInfo(`debug for ${service.name} in ${environment} ended, as set`)
    }
  }).pipe(
    Effect.catch((failure) => Effect.logWarning(`debug could not be put back in ${environment}: ${failure.message}`)),
  )
  return once.pipe(Effect.repeat(Schedule.spaced("60 seconds")), Effect.andThen(Effect.never))
}
