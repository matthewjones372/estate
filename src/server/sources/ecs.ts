/**
 * Services on ECS: each service's running tasks as its instances, its scheduled tasks' last runs as jobs, and its
 * primary deployment as what was chosen, stalled with ECS's own reason when a rollout fails.
 */
import { Effect, Schema } from "effect"
import { ecsOf, type Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Job, Pod } from "../../shared/events"
import type { AwsCallError, AwsJson } from "../aws/json"
import type { Chosen, Workloads } from "../state"
import { iso } from "../time"
import { type Failure, SourceFailure } from "./run"

export const ecsApi = {
  service: "ecs",
  target: "AmazonEC2ContainerServiceV20141113",
  version: "1.1",
  name: "ECS",
} as const

const Deployment = Schema.Struct({
  status: Schema.String,
  taskDefinition: Schema.String,
  rolloutState: Schema.optionalKey(Schema.String),
  rolloutStateReason: Schema.optionalKey(Schema.String),
  runningCount: Schema.Number,
  desiredCount: Schema.Number,
  failedTasks: Schema.optionalKey(Schema.Number),
  updatedAt: Schema.optionalKey(Schema.Number),
})
const Services = Schema.Struct({
  services: Schema.Array(
    Schema.Struct({
      serviceName: Schema.String,
      deployments: Schema.Array(Deployment),
      events: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
    }),
  ),
})
const TaskArns = Schema.Struct({ taskArns: Schema.Array(Schema.String) })
const Task = Schema.Struct({
  taskArn: Schema.String,
  lastStatus: Schema.String,
  healthStatus: Schema.optionalKey(Schema.String),
  startedAt: Schema.optionalKey(Schema.Number),
  stoppedAt: Schema.optionalKey(Schema.Number),
  stoppedReason: Schema.optionalKey(Schema.String),
  availabilityZone: Schema.optionalKey(Schema.String),
  containers: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      image: Schema.optionalKey(Schema.String),
      exitCode: Schema.optionalKey(Schema.Number),
      reason: Schema.optionalKey(Schema.String),
    }),
  ),
})
type Task = typeof Task.Type
const Tasks = Schema.Struct({ tasks: Schema.Array(Task) })
const TaskDefinition = Schema.Struct({
  taskDefinition: Schema.Struct({
    containerDefinitions: Schema.Array(Schema.Struct({ name: Schema.String, image: Schema.String })),
  }),
})

/** ECS's answer to `operation`, read as `schema`, or a failure in ECS's words. */
const ask = <S extends Schema.Decoder<unknown>>(ecs: AwsJson, operation: string, body: object, schema: S) =>
  ecs(operation, body).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(
      (error: AwsCallError | Schema.SchemaError): Failure =>
        new SourceFailure({
          message:
            error._tag === "AwsCallError"
              ? `ECS ${error.message}`
              : `ECS answered ${operation} in a shape Estate does not know`,
        }),
    ),
  )

const when = (seconds: number | undefined) => (seconds === undefined ? undefined : iso(seconds * 1000))

const idOf = (arn: string) => arn.slice(arn.lastIndexOf("/") + 1)

/** The image named for the service, or the task's first. */
const imageOf = (service: Service, images: ReadonlyArray<{ readonly name: string; readonly image?: string }>) =>
  (images.find((each) => each.name === service.name) ?? images[0])?.image

/** Tasks listed by `filter`, described, newest first. */
const tasksBy = (ecs: AwsJson, cluster: string, filter: object) =>
  ask(ecs, "ListTasks", { cluster, ...filter }, TaskArns).pipe(
    Effect.flatMap(({ taskArns }) =>
      taskArns.length === 0
        ? Effect.succeed([])
        : ask(ecs, "DescribeTasks", { cluster, tasks: taskArns.slice(0, 100) }, Tasks).pipe(
            Effect.map(({ tasks }) => tasks),
          ),
    ),
    Effect.map((tasks) => [...tasks].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))),
  )

const podOf = (service: Service, task: Task): Pod =>
  compact({
    name: idOf(task.taskArn),
    phase: task.lastStatus,
    ready: task.lastStatus === "RUNNING" && task.healthStatus !== "UNHEALTHY",
    restarts: 0,
    image: imageOf(service, task.containers),
    node: task.availabilityZone,
    startedAt: when(task.startedAt),
  })

/** A scheduled task's run: running until it stops, then succeeded only if every container exited 0. */
const runOf = (task: Task) => {
  const stopped = task.lastStatus === "STOPPED"
  const failed = task.containers.find((container) => container.exitCode !== 0)
  return compact({
    name: idOf(task.taskArn),
    outcome: !stopped ? ("running" as const) : failed === undefined ? ("succeeded" as const) : ("failed" as const),
    startedAt: when(task.startedAt) ?? iso(0),
    finishedAt: stopped ? when(task.stoppedAt) : undefined,
    message: stopped && failed !== undefined ? (failed.reason ?? task.stoppedReason) : undefined,
  })
}

/** A scheduled task's last runs, by its task family in its cluster. */
export const scheduledTaskOf = (ecs: AwsJson, cluster: string, family: string): Effect.Effect<Job, Failure> =>
  Effect.all([
    tasksBy(ecs, cluster, { family, desiredStatus: "RUNNING" }),
    tasksBy(ecs, cluster, { family, desiredStatus: "STOPPED" }),
  ]).pipe(
    Effect.map(([running, stopped]) => ({
      name: family,
      kind: "ScheduledTask",
      suspended: false,
      runs: [...running, ...stopped].slice(0, 5).map(runOf),
    })),
  )

/** Each service's running tasks, and its scheduled tasks' last runs. */
export const readEcsWorkloads = (ecs: AwsJson, services: ReadonlyArray<Service>): Effect.Effect<Workloads, Failure> =>
  Effect.forEach(
    services.flatMap((service) => {
      const runtime = ecsOf(service)
      return runtime === undefined ? [] : [[service, runtime] as const]
    }),
    ([service, runtime]) =>
      Effect.gen(function* () {
        const tasks = yield* tasksBy(ecs, runtime.cluster, { serviceName: runtime.service, desiredStatus: "RUNNING" })
        const jobs = yield* Effect.forEach(
          (service.jobs ?? []).filter((job) => job.kind === "ScheduledTask"),
          (job) => scheduledTaskOf(ecs, runtime.cluster, job.name),
        )
        return [service.name, tasks.map((task) => podOf(service, task)), jobs] as const
      }),
    { concurrency: 4 },
  ).pipe(
    Effect.map((read) => ({
      pods: Object.fromEntries(read.map(([name, pods]) => [name, pods])),
      jobs: Object.fromEntries(read.map(([name, , jobs]) => [name, jobs])),
      debug: {},
    })),
  )

/** Why the primary deployment is stuck, in ECS's words; nothing while it is rolling out as it should. */
const stalledBy = (
  deployment: typeof Deployment.Type,
  events: ReadonlyArray<{ readonly message: string }>,
): string | undefined => {
  if (deployment.rolloutState === "FAILED") return deployment.rolloutStateReason ?? "the rollout failed"
  if ((deployment.failedTasks ?? 0) === 0) return undefined
  const latest = events[0]?.message
  return `${deployment.failedTasks} task${deployment.failedTasks === 1 ? "" : "s"} failed to start${latest === undefined ? "" : `: ${latest}`}`
}

/**
 * What each service's primary deployment chose: the tag of the image its task definition names (remembered, since a
 * task definition never changes), whether it has finished rolling out, and why not.
 */
export const readEcsDeploys = (
  ecs: AwsJson,
  services: ReadonlyArray<Service>,
  images: Map<string, string | undefined>,
): Effect.Effect<Readonly<Record<string, Chosen>>, Failure> =>
  Effect.forEach(
    services.flatMap((service) => {
      const runtime = ecsOf(service)
      return runtime === undefined ? [] : [[service, runtime] as const]
    }),
    ([service, runtime]) =>
      Effect.gen(function* () {
        const described = yield* ask(
          ecs,
          "DescribeServices",
          { cluster: runtime.cluster, services: [runtime.service] },
          Services,
        )
        const found = described.services[0]
        const primary = found?.deployments.find((deployment) => deployment.status === "PRIMARY")
        if (found === undefined || primary === undefined) return []
        const known = images.has(primary.taskDefinition)
        const image = known
          ? images.get(primary.taskDefinition)
          : imageOf(
              service,
              (yield* ask(ecs, "DescribeTaskDefinition", { taskDefinition: primary.taskDefinition }, TaskDefinition))
                .taskDefinition.containerDefinitions,
            )
        images.set(primary.taskDefinition, image)
        const colon = image?.lastIndexOf(":") ?? -1
        const chosen: Chosen = compact({
          version:
            image !== undefined && colon > image.lastIndexOf("/")
              ? image.slice(colon + 1)
              : idOf(primary.taskDefinition),
          ready: primary.rolloutState !== "IN_PROGRESS" && primary.runningCount === primary.desiredCount,
          at: when(primary.updatedAt),
          stalled: stalledBy(primary, found.events ?? []),
        })
        return [[service.name, chosen] as const]
      }),
    { concurrency: 4 },
  ).pipe(Effect.map((read) => Object.fromEntries(read.flat())))
