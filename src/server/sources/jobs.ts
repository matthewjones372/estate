/**
 * A service's Jobs and CronJobs: each one's schedule, its last runs and how they ended, its next run, and a run its
 * schedule says should have started and did not.
 */
import { Cron, Duration, Effect, Result, Schema } from "effect"
import type { Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Job } from "../../shared/events"
import type { Remote } from "../remote"
import { after, epoch, iso, isoOf } from "../time"
import { type Cluster, Condition, kube, Metadata } from "./kubernetes"
import type { Failure } from "./run"

const JobObject = Schema.Struct({
  metadata: Schema.Struct({
    ...Metadata.fields,
    ownerReferences: Schema.optionalKey(Schema.Array(Schema.Struct({ kind: Schema.String, name: Schema.String }))),
  }),
  status: Schema.optionalKey(
    Schema.Struct({
      startTime: Schema.optionalKey(Schema.String),
      completionTime: Schema.optionalKey(Schema.String),
      active: Schema.optionalKey(Schema.Number),
      succeeded: Schema.optionalKey(Schema.Number),
      conditions: Schema.optionalKey(Schema.Array(Condition)),
    }),
  ),
})
type JobObject = typeof JobObject.Type

const Jobs = Schema.Struct({ items: Schema.Array(JobObject) })

const CronJobObject = Schema.Struct({
  spec: Schema.Struct({
    schedule: Schema.String,
    suspend: Schema.optionalKey(Schema.Boolean),
    timeZone: Schema.optionalKey(Schema.String),
  }),
  status: Schema.optionalKey(Schema.Struct({ lastScheduleTime: Schema.optionalKey(Schema.String) })),
})

const kept = 5
const grace = Duration.minutes(5)

/** A Job as a run: running, or how it ended, in the cluster's words when it failed. */
export const runOf = (job: JobObject): Job["runs"][number] => {
  const failed = job.status?.conditions?.find((condition) => condition.type === "Failed" && condition.status === "True")
  const outcome = failed !== undefined ? "failed" : (job.status?.succeeded ?? 0) > 0 ? "succeeded" : "running"
  return compact({
    name: job.metadata.name,
    outcome,
    startedAt: job.status?.startTime ?? epoch,
    finishedAt: failed?.lastTransitionTime ?? job.status?.completionTime,
    message: failed?.message ?? failed?.reason,
  })
}

/** When a schedule next runs after `from`, if it is a schedule Estate can read. */
export const nextRun = (schedule: string, timeZone: string | undefined, from: Date): Date | undefined => {
  const cron = Cron.parse(schedule, timeZone ?? "UTC")
  return Result.isSuccess(cron) ? Cron.next(cron.success, from) : undefined
}

const newestFirst = (a: Job["runs"][number], b: Job["runs"][number]) => b.startedAt.localeCompare(a.startedAt)

const jobFor = (
  cluster: Cluster,
  namespace: string,
  wanted: NonNullable<Service["jobs"]>[number],
  now: number,
  listed: Effect.Effect<typeof Jobs.Type, Failure, Remote>,
): Effect.Effect<Job, Failure, Remote> => {
  const path = `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}`
  if (wanted.kind === "Job") {
    return kube(cluster, `${path}/jobs/${encodeURIComponent(wanted.name)}`, JobObject).pipe(
      Effect.map((job) => ({ name: wanted.name, kind: "Job", suspended: false, runs: [runOf(job)] })),
    )
  }
  return Effect.gen(function* () {
    const cronJob = yield* kube(cluster, `${path}/cronjobs/${encodeURIComponent(wanted.name)}`, CronJobObject)
    const jobs = yield* listed
    const runs = jobs.items
      .filter((job) =>
        (job.metadata.ownerReferences ?? []).some((owner) => owner.kind === "CronJob" && owner.name === wanted.name),
      )
      .map(runOf)
      .sort(newestFirst)
      .slice(0, kept)
    const { schedule, timeZone, suspend = false } = cronJob.spec
    const last = cronJob.status?.lastScheduleTime
    const due = last === undefined ? undefined : nextRun(schedule, timeZone, new Date(last))
    const missed = !suspend && due !== undefined && after(due.getTime(), grace) < now ? iso(due) : undefined
    return compact({
      name: wanted.name,
      kind: "CronJob",
      schedule,
      suspended: suspend,
      runs,
      next: suspend ? undefined : isoOf(nextRun(schedule, timeZone, new Date(now))),
      missed,
    })
  })
}

/** A service's jobs, as the catalog names them. */
export const jobsOf = (
  cluster: Cluster,
  service: Service,
  now: number,
): Effect.Effect<ReadonlyArray<Job>, Failure, Remote> => {
  const namespace = service.kubernetes?.namespace
  if (namespace === undefined) return Effect.succeed([])
  // The namespace's Jobs are listed once per read, however many of its CronJobs the catalog names.
  const path = `/apis/batch/v1/namespaces/${encodeURIComponent(namespace)}/jobs`
  return Effect.flatMap(Effect.cached(kube(cluster, path, Jobs)), (listed) =>
    Effect.forEach(service.jobs ?? [], (wanted) => jobFor(cluster, namespace, wanted, now, listed), { concurrency: 2 }),
  )
}
