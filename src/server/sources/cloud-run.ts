/**
 * Services and jobs on Google Cloud Run: active revisions as instances (pods), deployment rollout status as chosen,
 * and Cloud Run Job executions as job runs.
 */
import { Effect, Schema } from "effect"
import { cloudRunOf, type Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Job, JobRun, Pod } from "../../shared/events"
import type { GcpCallError, GcpJson } from "../gcp/json"
import type { Chosen, Workloads } from "../state"
import { type Failure, SourceFailure } from "./run"

const optional = Schema.optionalKey

const Condition = Schema.Struct({
  type: optional(Schema.String),
  state: optional(Schema.String),
  message: optional(Schema.String),
})

const Revision = Schema.Struct({
  name: Schema.String,
  createTime: optional(Schema.String),
  containers: optional(Schema.Array(Schema.Struct({ name: optional(Schema.String), image: Schema.String }))),
  conditions: optional(Schema.Array(Condition)),
})

const RevisionsList = Schema.Struct({ revisions: optional(Schema.Array(Revision)) })

const CloudRunService = Schema.Struct({
  name: Schema.String,
  latestReadyRevision: optional(Schema.String),
  latestCreatedRevision: optional(Schema.String),
  terminalCondition: optional(Condition),
  template: optional(
    Schema.Struct({
      containers: optional(Schema.Array(Schema.Struct({ name: optional(Schema.String), image: Schema.String }))),
    }),
  ),
  updateTime: optional(Schema.String),
})

const Execution = Schema.Struct({
  name: Schema.String,
  createTime: optional(Schema.String),
  completionTime: optional(Schema.String),
  succeededCount: optional(Schema.Number),
  failedCount: optional(Schema.Number),
  cancelledCount: optional(Schema.Number),
  conditions: optional(Schema.Array(Condition)),
})

const ExecutionsList = Schema.Struct({ executions: optional(Schema.Array(Execution)) })

const shortName = (resourceName: string) => resourceName.slice(resourceName.lastIndexOf("/") + 1)

const decode =
  <S extends Schema.Decoder<unknown>>(schema: S, operation: string) =>
  (body: unknown): Effect.Effect<S["Type"], Failure> =>
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => new SourceFailure({ message: `Cloud Run answered ${operation} in an unexpected shape` })),
    )

const gcpFailure = (error: GcpCallError): Failure => new SourceFailure({ message: `Cloud Run ${error.message}` })

const imageTagOf = (image: string): string => {
  const at = image.indexOf("@")
  const digest = at >= 0 ? image.slice(at + 1) : undefined
  if (digest !== undefined) return digest.slice(0, 12)
  const lastColon = image.lastIndexOf(":")
  return lastColon >= 0 ? image.slice(lastColon + 1) : image
}

const podOf = (revision: typeof Revision.Type): Pod => {
  const readyCondition = revision.conditions?.find((c) => c.type === "Ready")
  const isReady = readyCondition?.state === "CONDITION_SUCCEEDED"
  const isFailed = readyCondition?.state === "CONDITION_FAILED"
  const phase = isReady ? "RUNNING" : isFailed ? "FAILED" : "PENDING"
  const image = revision.containers?.[0]?.image
  return compact({
    name: shortName(revision.name),
    phase,
    ready: isReady,
    restarts: 0,
    image,
    startedAt: revision.createTime,
  })
}

const runOf = (execution: typeof Execution.Type): JobRun => {
  const completeCondition = execution.conditions?.find((c) => c.type === "Completed")
  const isComplete = execution.completionTime !== undefined
  const succeeded = (execution.succeededCount ?? 0) > 0 || completeCondition?.state === "CONDITION_SUCCEEDED"
  const outcome = !isComplete ? ("running" as const) : succeeded ? ("succeeded" as const) : ("failed" as const)
  return compact({
    name: shortName(execution.name),
    outcome,
    startedAt: execution.createTime ?? new Date(0).toISOString(),
    finishedAt: execution.completionTime,
    message: !succeeded ? completeCondition?.message : undefined,
  })
}

/** Last executions of a Cloud Run Job. */
export const cloudRunJobOf = (
  gcp: GcpJson,
  project: string,
  region: string,
  jobName: string,
): Effect.Effect<Job, Failure> => {
  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/jobs/${jobName}/executions`
  return gcp({ url }).pipe(
    Effect.mapError(gcpFailure),
    Effect.flatMap(decode(ExecutionsList, "executions")),
    Effect.map((list) => ({
      name: jobName,
      kind: "CloudRunJob",
      suspended: false,
      runs: (list.executions ?? []).slice(0, 5).map(runOf),
    })),
  )
}

/** Each Cloud Run service's active revisions as pods, and its jobs' executions. */
export const readCloudRunWorkloads = (
  gcp: GcpJson,
  project: string,
  defaultRegion: string,
  services: ReadonlyArray<Service>,
): Effect.Effect<Workloads, Failure> =>
  Effect.forEach(
    services.flatMap((service) => {
      const runtime = cloudRunOf(service)
      return runtime === undefined ? [] : [[service, runtime] as const]
    }),
    ([service, runtime]) =>
      Effect.gen(function* () {
        const region = runtime.region ?? defaultRegion
        const serviceName = runtime.service || service.name
        const revisionsUrl = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${serviceName}/revisions`
        const revisionsList = yield* gcp({ url: revisionsUrl }).pipe(
          Effect.mapError(gcpFailure),
          Effect.flatMap(decode(RevisionsList, "revisions")),
        )
        const pods = (revisionsList.revisions ?? []).map(podOf)
        const jobs = yield* Effect.forEach(
          (service.jobs ?? []).filter((job) => job.kind === "CloudRunJob"),
          (job) => cloudRunJobOf(gcp, project, region, job.name),
        )
        return [service.name, pods, jobs] as const
      }),
    { concurrency: 4 },
  ).pipe(
    Effect.map((read) => ({
      pods: Object.fromEntries(read.map(([name, pods]) => [name, pods])),
      jobs: Object.fromEntries(read.map(([name, , jobs]) => [name, jobs])),
      debug: {},
    })),
  )

/** Deployment status for Cloud Run services. */
export const readCloudRunDeploys = (
  gcp: GcpJson,
  project: string,
  defaultRegion: string,
  services: ReadonlyArray<Service>,
): Effect.Effect<Readonly<Record<string, Chosen>>, Failure> =>
  Effect.forEach(
    services.flatMap((service) => {
      const runtime = cloudRunOf(service)
      return runtime === undefined ? [] : [[service, runtime] as const]
    }),
    ([service, runtime]) =>
      Effect.gen(function* () {
        const region = runtime.region ?? defaultRegion
        const serviceName = runtime.service || service.name
        const serviceUrl = `https://run.googleapis.com/v2/projects/${project}/locations/${region}/services/${serviceName}`
        const svc = yield* gcp({ url: serviceUrl }).pipe(
          Effect.mapError(gcpFailure),
          Effect.flatMap(decode(CloudRunService, "service")),
        )
        const image = svc.template?.containers?.[0]?.image
        const version = image !== undefined ? imageTagOf(image) : shortName(svc.latestCreatedRevision ?? serviceName)
        const isReady =
          svc.latestReadyRevision !== undefined &&
          svc.latestReadyRevision === svc.latestCreatedRevision &&
          svc.terminalCondition?.state === "CONDITION_SUCCEEDED"
        const stalled =
          svc.terminalCondition?.state === "CONDITION_FAILED"
            ? (svc.terminalCondition.message ?? "rollout failed")
            : undefined

        const chosen: Chosen = compact({
          version,
          ready: isReady,
          at: svc.updateTime,
          stalled,
        })
        return [service.name, chosen] as const
      }),
    { concurrency: 4 },
  ).pipe(Effect.map((entries) => Object.fromEntries(entries)))
