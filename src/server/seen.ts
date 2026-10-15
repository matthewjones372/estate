/**
 * What changes around an open incident (spec 0047): each read of its services compared with the last, and each change
 * kept as one of its events. A watcher keeps its own environment's, so in a cluster the runner that owns an
 * environment keeps each change there once.
 */
import { Clock, Effect, Stream, SubscriptionRef } from "effect"
import { type EventKind, seenLive } from "../shared/timeline"
import type { Pod } from "../shared/workloads"
import { Notes } from "./notes"
import { type EnvironmentState, Estate, type EstateState } from "./state"
import { iso } from "./time"
import { healthOf } from "./views/health"
import { incidentServices } from "./views/incident-scope"
import { versionOf } from "./views/services"

export interface Change {
  readonly kind: EventKind
  readonly text: string
  /** Who did it, where the source says: whoever switched debug on. Estate otherwise. */
  readonly by?: string
  readonly link?: string
}

const many = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** Whether `to` is a lower version than `from`, number by number; a version with no numbers is never lower. */
const lower = (from: string, to: string) => {
  const [was, now] = [from, to].map((version) => version.match(/\d+/g)?.map(Number) ?? [])
  const at = (was ?? []).findIndex((number, index) => number !== (now?.[index] ?? 0))
  return (now ?? []).length > 0 && at !== -1 && (now?.[at] ?? 0) < (was?.[at] ?? 0)
}

// Only what both reads saw is compared, so a source answering for the first time is not a change.
const podsOf = (state: EnvironmentState | undefined, service: string) =>
  state?.cluster.state === "ok" ? state.cluster.value?.pods[service] : undefined

const runningOf = (pods: ReadonlyArray<Pod> | undefined) =>
  versionOf(pods?.find((pod) => pod.ready)?.image ?? pods?.[0]?.image)

/** The service and environment a change is told in. */
interface Place {
  readonly service: string
  readonly environment: string
}

const versions = (
  was: ReadonlyArray<Pod> | undefined,
  now: ReadonlyArray<Pod> | undefined,
  { service, environment }: Place,
) => {
  const [from, to] = [runningOf(was), runningOf(now)]
  if (from === undefined || to === undefined || from === to) return []
  const back = lower(from, to) ? ", rolled back" : ""
  return [{ kind: "deployed", text: `${service} ${from} → ${to} in ${environment}${back}` } as const]
}

const restarts = (was: ReadonlyArray<Pod> | undefined, now: ReadonlyArray<Pod> | undefined): ReadonlyArray<Change> =>
  (now ?? []).flatMap((pod) => {
    const before = was?.find((each) => each.name === pod.name)
    if (before === undefined || pod.restarts <= before.restarts) return []
    const why = pod.lastTermination === undefined ? "" : ` (${pod.lastTermination})`
    return [{ kind: "restarted", text: `${pod.name} restarted${why}, ${many(pod.restarts, "restart")}` }]
  })

const scaled = (
  was: ReadonlyArray<Pod> | undefined,
  now: ReadonlyArray<Pod> | undefined,
  { service, environment }: Place,
) =>
  was === undefined || now === undefined || was.length === now.length
    ? []
    : [{ kind: "scaled", text: `${service} ${was.length} → ${many(now.length, "pod")} in ${environment}` } as const]

const chosen = (
  was: EnvironmentState | undefined,
  now: EnvironmentState | undefined,
  { service, environment }: Place,
) => {
  const [from, to] = [was?.deploys.value?.[service], now?.deploys.value?.[service]]
  if (from === undefined || to === undefined || from.version === to.version) return []
  const ready = to.ready ? "ready" : "not yet ready"
  return [{ kind: "chosen", text: `${service} ${to.version} chosen in ${environment}, ${ready}` } as const]
}

const outcome = { failure: "failed", success: "passed", cancelled: "was cancelled" } as const

const builds = (before: EstateState, after: EstateState, service: string): ReadonlyArray<Change> => {
  const [from, to] = [before.builds.value?.[service]?.[0], after.builds.value?.[service]?.[0]]
  if (from === undefined || to === undefined || (from.sha === to.sha && from.status === to.status)) return []
  if (to.status === "running" || to.status === "queued") return []
  const job = to.job === undefined ? "" : ` at ${to.job}`
  return [{ kind: "build", text: `${service} ${to.title} ${outcome[to.status]}${job}`, link: to.url }]
}

const health = (before: EstateState, after: EstateState, { service, environment }: Place) => {
  const found = after.catalog.services.find((each) => each.name === service)
  const [was, now] = [before.environments[environment], after.environments[environment]]
  if (found === undefined || was === undefined || now === undefined) return []
  const [from, to] = [healthOf(found, was, before.catalog.services), healthOf(found, now, after.catalog.services)]
  if (from.health === to.health || from.health === "unknown" || to.health === "unknown") return []
  const why = to.reasons.length === 0 ? "" : `: ${to.reasons.join(", ")}`
  return [{ kind: "health-changed", text: `${service} ${from.health} → ${to.health} in ${environment}${why}` } as const]
}

const debug = (
  was: EnvironmentState | undefined,
  now: EnvironmentState | undefined,
  { service, environment }: Place,
) => {
  if (was?.cluster.value === undefined || now?.cluster.value === undefined) return []
  const [from, to] = [was.cluster.value.debug[service], now.cluster.value.debug[service]]
  if ((from?.on ?? false) === (to?.on ?? false)) return []
  const until = to?.until === undefined ? "" : ` until ${to.until.slice(11, 16)}`
  return [
    {
      kind: "debug",
      text:
        to?.on === true
          ? `debug on for ${service} in ${environment}${until}`
          : `debug off for ${service} in ${environment}`,
      ...(to?.by === undefined ? {} : { by: to.by }),
    } as const,
  ]
}

const jobs = (
  was: EnvironmentState | undefined,
  now: EnvironmentState | undefined,
  { service, environment }: Place,
) => {
  if (was?.cluster.value === undefined) return []
  const last = (runs: ReadonlyArray<{ readonly name: string; readonly outcome: string }> | undefined) =>
    runs?.find((run) => run.outcome !== "running")
  return (now?.cluster.value?.jobs?.[service] ?? []).flatMap((job) => {
    const [from, to] = [
      last(was.cluster.value?.jobs?.[service]?.find((each) => each.name === job.name)?.runs),
      last(job.runs),
    ]
    return to?.outcome === "failed" && to.name !== from?.name
      ? [{ kind: "job", text: `job ${job.name} failed in ${environment}` } as const]
      : []
  })
}

/** What changed for `service` in `environment` from one read of the estate to the next, in the order it is told. */
export const changesOf = (
  before: EstateState,
  after: EstateState,
  environment: string,
  service: string,
): ReadonlyArray<Change> => {
  const [was, now] = [before.environments[environment], after.environments[environment]]
  const [podsWas, podsNow] = [podsOf(was, service), podsOf(now, service)]
  const place = { service, environment }
  return [
    ...versions(podsWas, podsNow, place),
    ...chosen(was, now, place),
    ...builds(before, after, service),
    ...restarts(podsWas, podsNow),
    ...scaled(podsWas, podsNow, place),
    ...health(before, after, place),
    ...debug(was, now, place),
    ...jobs(was, now, place),
  ]
}

/** For as long as Estate runs: what changes for an open incident's services, in `only` or every environment. */
export const recordSeen = (only?: string) =>
  Effect.gen(function* () {
    const ref = yield* Estate
    const notes = yield* Notes
    let was = yield* SubscriptionRef.get(ref)
    yield* SubscriptionRef.changes(ref).pipe(
      Stream.runForEach((now) =>
        Effect.gen(function* () {
          const before = was
          was = now
          const at = iso(yield* Clock.currentTimeMillis)
          const kept = (now.incidents ?? [])
            .filter((incident) => incident.closedAt === undefined)
            .flatMap((incident) => {
              const environments = [...new Set(incident.firings.map((firing) => firing.environment))].sort()
              return environments
                .filter((environment) => only === undefined || environment === only)
                .flatMap((environment) =>
                  incidentServices(now, incident).flatMap((service) =>
                    changesOf(before, now, environment, service)
                      // A build is not an environment's, so only the incident's first environment keeps it.
                      .filter((change) => change.kind !== "build" || environment === environments[0])
                      .map(({ kind, text, by, link }) => ({
                        incident: incident.id,
                        ...seenLive({ id: crypto.randomUUID(), at, by: by ?? "Estate", kind, text }),
                        ...(link === undefined ? {} : { link }),
                        service,
                      })),
                  ),
                )
            })
          yield* Effect.forEach(kept, (event) => notes.addIncidentEvent(event), { discard: true }).pipe(
            Effect.catch((failure) => Effect.logWarning(`what changed could not be kept: ${failure.message}`)),
          )
        }),
      ),
    )
  })
