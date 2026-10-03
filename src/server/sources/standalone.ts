/** Jobs no service owns, read beside the services' workloads, in the same runtime and the same way. */
import { Effect } from "effect"
import { runsAs, type StandaloneJob } from "../../shared/catalog"
import type { Job } from "../../shared/events"
import type { AwsJson } from "../aws/json"
import type { Remote } from "../remote"
import type { Workloads } from "../state"
import { scheduledTaskOf } from "./ecs"
import { jobsOf } from "./jobs"
import type { Cluster } from "./kubernetes"
import type { Failure } from "./run"

type Read = Readonly<Record<string, ReadonlyArray<Job>>>

const byName = (read: ReadonlyArray<readonly [string, ReadonlyArray<Job>]>): Read => Object.fromEntries(read)

/** Each Kubernetes job's runs, as a service's CronJob or Job in that namespace is read. */
export const kubernetesJobs = (
  cluster: Cluster,
  jobs: ReadonlyArray<StandaloneJob>,
  now: number,
): Effect.Effect<Read, Failure, Remote> =>
  Effect.forEach(
    jobs.flatMap((job) => ("kubernetes" in job.run ? [[job, job.run.kubernetes.namespace] as const] : [])),
    ([job, namespace]) => {
      const runs = runsAs(job)
      const kind = runs.kind === "Job" ? "Job" : "CronJob"
      const asService = { name: job.name, environments: job.environments, kubernetes: { namespace, workloads: [] } }
      return Effect.map(
        jobsOf(cluster, { ...asService, jobs: [{ kind, name: runs.name }] }, now),
        (read) => [job.name, read] as const,
      )
    },
    { concurrency: 4 },
  ).pipe(Effect.map(byName))

/** Each ECS job's runs, as a service's scheduled task is read. */
export const ecsJobs = (ecs: AwsJson, jobs: ReadonlyArray<StandaloneJob>): Effect.Effect<Read, Failure> =>
  Effect.forEach(
    jobs.flatMap((job) => ("ecs" in job.run ? [[job, job.run.ecs] as const] : [])),
    ([job, run]) =>
      Effect.map(scheduledTaskOf(ecs, run.cluster, run.scheduledTask), (read) => [job.name, [read]] as const),
    { concurrency: 4 },
  ).pipe(Effect.map(byName))

/** The services' workloads with the jobs no service owns beside them. */
export const withJobs = (workloads: Workloads, jobs: Read): Workloads => ({
  ...workloads,
  jobs: { ...workloads.jobs, ...jobs },
})
