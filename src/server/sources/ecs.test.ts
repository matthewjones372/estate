import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Result, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import type { Service } from "../../shared/catalog"
import { type AwsJson, makeAwsJson } from "../aws/json"
import { catalog, estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import { Estate, estateLayer } from "../state"
import { ecsApi, readEcsDeploys, readEcsWorkloads } from "./ecs"
import { ecsJobs, withJobs } from "./standalone"
import { startSources } from "./start"

const orders: Service = {
  name: "orders",
  environments: ["staging"],
  runtime: { ecs: { cluster: "shop", service: "orders" } },
  jobs: [{ kind: "ScheduledTask", name: "orders-nightly-export" }],
}
const seconds = (at: string) => Date.parse(at) / 1000

const task = (id: string, extra: object = {}) => ({
  taskArn: `arn:aws:ecs:eu-west-2:1:task/shop/${id}`,
  lastStatus: "RUNNING",
  healthStatus: "HEALTHY",
  startedAt: seconds("2026-10-03T10:00:00Z"),
  availabilityZone: "eu-west-2a",
  containers: [
    { name: "log-router", image: "fluent-bit:2" },
    { name: "orders", image: "registry.example/orders:v2.4.0" },
  ],
  ...extra,
})

const primary = (extra: object = {}) => ({
  status: "PRIMARY",
  taskDefinition: "arn:aws:ecs:eu-west-2:1:task-definition/orders:12",
  rolloutState: "COMPLETED",
  runningCount: 2,
  desiredCount: 2,
  updatedAt: seconds("2026-10-03T11:40:00Z"),
  ...extra,
})

/** ECS as a stub, answering by operation; `deployment` is the primary one DescribeServices gives. */
const fakeEcs =
  (calls: Call[], deployment: object = primary()) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    const operation = call.headers?.["x-amz-target"]?.split(".")[1]
    const body = JSON.parse(call.body ?? "{}")
    if (operation === "ListTasks") {
      if (body.serviceName === "orders") return reply({ taskArns: ["t1", "t2"] })
      if (body.family !== undefined && body.desiredStatus === "STOPPED") return reply({ taskArns: ["s1", "s2"] })
      return reply({ taskArns: [] })
    }
    if (operation === "DescribeTasks") {
      if (body.tasks[0] === "t1")
        return reply({ tasks: [task("t1"), task("t2", { healthStatus: "UNHEALTHY", startedAt: undefined })] })
      return reply({
        tasks: [
          task("s1", {
            lastStatus: "STOPPED",
            stoppedAt: seconds("2026-10-03T02:05:00Z"),
            startedAt: seconds("2026-10-03T02:00:00Z"),
            containers: [{ name: "export", exitCode: 0 }],
          }),
          task("s2", {
            lastStatus: "STOPPED",
            stoppedAt: seconds("2026-10-02T02:01:00Z"),
            startedAt: seconds("2026-10-02T02:00:00Z"),
            stoppedReason: "Essential container in task exited",
            containers: [{ name: "export", exitCode: 1, reason: "OutOfMemoryError: Container killed" }],
          }),
        ],
      })
    }
    if (operation === "DescribeServices")
      return reply({
        services: [
          {
            serviceName: "orders",
            deployments: [deployment, { ...primary(), status: "ACTIVE" }],
            events: [
              { message: "(service orders) was unable to place a task: no container instance met requirements" },
            ],
          },
        ],
      })
    if (operation === "DescribeTaskDefinition")
      return reply({
        taskDefinition: { containerDefinitions: [{ name: "orders", image: "registry.example/orders:v2.4.0" }] },
      })
    return undefined
  }

const keys = ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "secret" })

const withEcs = <A, E>(use: (ecs: AwsJson) => Effect.Effect<A, E>, answer: (call: Call) => Reply | undefined) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(makeAwsJson(ecsApi, "eu-west-2"), use).pipe(
        Effect.provide(Layer.merge(stubRemote(answer), platform)),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ),
  )

describe("services on ECS", () => {
  test("are their running tasks, ready unless unhealthy, and their scheduled tasks' runs", () =>
    withEcs((ecs) => readEcsWorkloads(ecs, [orders, { name: "search", environments: [] }]), fakeEcs([])).then(
      (result) => {
        const workloads = Result.isSuccess(result) ? result.success : undefined
        expect(workloads?.pods).toEqual({
          orders: [
            {
              name: "t1",
              phase: "RUNNING",
              ready: true,
              restarts: 0,
              image: "registry.example/orders:v2.4.0",
              node: "eu-west-2a",
              startedAt: "2026-10-03T10:00:00.000Z",
            },
            {
              name: "t2",
              phase: "RUNNING",
              ready: false,
              restarts: 0,
              image: "registry.example/orders:v2.4.0",
              node: "eu-west-2a",
            },
          ],
        })
        expect(workloads?.jobs?.["orders"]).toEqual([
          {
            name: "orders-nightly-export",
            kind: "ScheduledTask",
            suspended: false,
            runs: [
              {
                name: "s1",
                outcome: "succeeded",
                startedAt: "2026-10-03T02:00:00.000Z",
                finishedAt: "2026-10-03T02:05:00.000Z",
              },
              {
                name: "s2",
                outcome: "failed",
                startedAt: "2026-10-02T02:00:00.000Z",
                finishedAt: "2026-10-02T02:01:00.000Z",
                message: "OutOfMemoryError: Container killed",
              },
            ],
          },
        ])
      },
    ))

  test("chose the image of the primary deployment's task definition, asked for once", () => {
    const calls: Call[] = []
    const images = new Map<string, string | undefined>()
    return withEcs(
      (ecs) => Effect.zip(readEcsDeploys(ecs, [orders], images), readEcsDeploys(ecs, [orders], images)),
      fakeEcs(calls),
    ).then((result) => {
      expect(Result.isSuccess(result) && result.success[1]).toEqual({
        orders: { version: "v2.4.0", ready: true, at: "2026-10-03T11:40:00.000Z" },
      })
      const definitions = calls.filter((call) => call.headers?.["x-amz-target"]?.endsWith("DescribeTaskDefinition"))
      expect(definitions).toHaveLength(1)
    })
  })

  test("are stalled with ECS's reason when a deployment fails, or its tasks fail to start", () =>
    Promise.all([
      withEcs(
        (ecs) => readEcsDeploys(ecs, [orders], new Map()),
        fakeEcs(
          [],
          primary({
            rolloutState: "FAILED",
            rolloutStateReason: "ECS deployment circuit breaker: tasks failed to start.",
          }),
        ),
      ),
      withEcs(
        (ecs) => readEcsDeploys(ecs, [orders], new Map()),
        fakeEcs([], primary({ rolloutState: "IN_PROGRESS", failedTasks: 2, runningCount: 0 })),
      ),
      withEcs((ecs) => readEcsDeploys(ecs, [orders], new Map()), fakeEcs([], primary({ rolloutState: "FAILED" }))),
    ]).then(([failed, failing, unexplained]) => {
      expect(Result.isSuccess(failed) && failed.success["orders"]?.stalled).toBe(
        "ECS deployment circuit breaker: tasks failed to start.",
      )
      expect(Result.isSuccess(failing) && failing.success["orders"]).toMatchObject({
        ready: false,
        stalled:
          "2 tasks failed to start: (service orders) was unable to place a task: no container instance met requirements",
      })
      expect(Result.isSuccess(unexplained) && unexplained.success["orders"]?.stalled).toBe("the rollout failed")
    }))

  test("name the task definition when its image has no tag, and skip a service ECS does not know", () => {
    const untagged = (call: Call) =>
      call.headers?.["x-amz-target"]?.endsWith("DescribeTaskDefinition")
        ? reply({ taskDefinition: { containerDefinitions: [{ name: "orders", image: "registry:5000/orders" }] } })
        : fakeEcs([])(call)
    const unknown = (call: Call) =>
      call.headers?.["x-amz-target"]?.endsWith("DescribeServices") ? reply({ services: [] }) : fakeEcs([])(call)
    return Promise.all([
      withEcs((ecs) => readEcsDeploys(ecs, [orders], new Map()), untagged),
      withEcs((ecs) => readEcsDeploys(ecs, [orders], new Map()), unknown),
    ]).then(([named, skipped]) => {
      expect(Result.isSuccess(named) && named.success["orders"]?.version).toBe("orders:12")
      expect(Result.isSuccess(skipped) && skipped.success).toEqual({})
    })
  })

  test("say what ECS said when it refuses, or answers in another shape", () =>
    Promise.all([
      withEcs(
        (ecs) => readEcsDeploys(ecs, [orders], new Map()),
        () => reply({ __type: "AccessDeniedException", message: "not allowed to DescribeServices" }, 400),
      ),
      withEcs(
        (ecs) => readEcsWorkloads(ecs, [orders]),
        () => reply({ odd: true }),
      ),
    ]).then(([refused, odd]) => {
      expect(Result.isFailure(refused) && refused.failure.message).toBe("ECS not allowed to DescribeServices")
      expect(Result.isFailure(odd) && odd.failure.message).toBe(
        "ECS answered ListTasks in a shape Estate does not know",
      )
    }))

  test("fill an environment's cluster and deploys when its sources name AWS", () => {
    const configured = { ...settings(), sources: { staging: { aws: { region: "eu-west-2" } }, production: {} } }
    const failing = primary({ rolloutState: "FAILED", rolloutStateReason: "tasks failed to start" })
    const program = Effect.gen(function* () {
      yield* Effect.forkChild(startSources(configured))
      yield* TestClock.adjust("1 second")
      return (yield* SubscriptionRef.get(yield* Estate)).environments["staging"]
    })
    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            estateLayer(estate({ catalog: { ...catalog, services: [orders] } })),
            TestClock.layer(),
            stubRemote(fakeEcs([], failing)),
            platform,
          ),
        ),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ).then((staging) => {
      expect(staging?.cluster.value?.pods["orders"]).toHaveLength(2)
      expect(staging?.deploys.value?.["orders"]?.stalled).toBe("tasks failed to start")
    })
  })
})

describe("a job no service owns, on ECS", () => {
  test("is its scheduled task's runs, beside the services' workloads", () =>
    withEcs(
      (ecs) =>
        Effect.map(
          ecsJobs(ecs, [
            { name: "export", environments: ["staging"], run: { ecs: { cluster: "shop", scheduledTask: "export" } } },
            { name: "settle", environments: ["staging"], run: { kubernetes: { namespace: "batch" } } },
          ]),
          (jobs) => withJobs({ pods: {}, debug: {}, jobs: { orders: [] } }, jobs),
        ),
      fakeEcs([]),
    ).then((result) => {
      const workloads = Result.isSuccess(result) ? result.success : undefined
      expect(Object.keys(workloads?.jobs ?? {})).toEqual(["orders", "export"])
      expect(workloads?.jobs?.["export"]?.[0]?.runs.map((run) => run.outcome)).toEqual(["succeeded", "failed"])
    }))
})
