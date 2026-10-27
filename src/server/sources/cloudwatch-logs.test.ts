import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Fiber, Layer, Ref, Result } from "effect"
import { TestClock } from "effect/testing"
import type { Service } from "../../shared/catalog"
import { platform } from "../platform"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import type { Sources } from "../settings"
import { CloudwatchBudget, cloudwatchBudgetLayer, logGroupFrom } from "./cloudwatch-logs"
import { logsFor } from "./logs"

const orders: Service = {
  name: "orders",
  environments: ["production"],
  runtime: { ecs: { cluster: "shop", service: "orders" } },
  logs: { mask: ["\\b\\d{16}\\b"] },
}
const section: Sources = { aws: { region: "eu-west-2" }, cloudwatchLogs: {} }

const awslogs = (group: string, prefix?: string) => ({
  logDriver: "awslogs",
  options: {
    "awslogs-group": group,
    "awslogs-region": "eu-west-2",
    ...(prefix === undefined ? {} : { "awslogs-stream-prefix": prefix }),
  },
})
const containers = [
  { name: "log-router", essential: false, logConfiguration: awslogs("/shop/production/firelens", "router") },
  { name: "orders", essential: true, logConfiguration: awslogs("/shop/production/orders", "ecs") },
]

const event = (at: string, message: string, task = "4f1c") => ({
  logStreamName: `ecs/orders/${task}`,
  timestamp: Date.parse(at),
  message,
})

/** ECS and CloudWatch Logs as a stub, answering by operation; `pages` are FilterLogEvents' answers in turn. */
const fakeAws =
  (calls: Call[], pages: ReadonlyArray<object>, defined: ReadonlyArray<object> = containers) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    const operation = call.headers?.["x-amz-target"]?.split(".")[1]
    if (operation === "DescribeServices")
      return reply({
        services: [
          {
            serviceName: "orders",
            deployments: [{ status: "PRIMARY", taskDefinition: "orders:7", runningCount: 1, desiredCount: 1 }],
          },
        ],
      })
    if (operation === "DescribeTaskDefinition")
      return reply({
        taskDefinition: { containerDefinitions: defined.map((each) => ({ image: "app:1", ...each })) },
      })
    if (operation === "FilterLogEvents") {
      const asked = calls.filter((each) => each.headers?.["x-amz-target"]?.endsWith(".FilterLogEvents")).length
      return reply(pages[asked - 1] ?? { events: [] })
    }
    return undefined
  }

const keys = ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "secret" })
const from = Date.parse("2026-10-27T11:45:00Z")
const to = Date.parse("2026-10-27T12:00:00Z")

const read = (answer: (call: Call) => Reply | undefined, service = orders, limit = 200) =>
  Effect.runPromise(
    Effect.result(
      (logsFor(section, service)?.read(from, to, limit) ?? Effect.succeed([])).pipe(
        Effect.provide(Layer.merge(stubRemote(answer), platform)),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ),
  )

const bodiesOf = (calls: ReadonlyArray<Call>, operation: string) =>
  calls
    .filter((call) => call.headers?.["x-amz-target"] === `Logs_20140328.${operation}`)
    .map((call) => JSON.parse(call.body ?? "{}"))

describe("a service's log group in CloudWatch", () => {
  test("is the one its task definition gives awslogs, its streams under the prefix and its container", () => {
    expect(logGroupFrom(orders, containers)).toEqual({ group: "/shop/production/orders", prefix: "ecs/orders/" })
  })

  test("is the catalog's where it names one, and its container where the task has several", () => {
    const named = (cloudwatch: object): Service => ({ ...orders, logs: { cloudwatch } })
    expect(logGroupFrom(named({ group: "/elsewhere", prefix: "web/" }), containers)).toEqual({
      group: "/elsewhere",
      prefix: "web/",
    })
    expect(logGroupFrom(named({ container: "log-router" }), containers)).toEqual({
      group: "/shop/production/firelens",
      prefix: "router/log-router/",
    })
  })

  test("is the whole group when awslogs has no stream prefix, and nothing when no container uses awslogs", () => {
    expect(logGroupFrom(orders, [{ name: "orders", logConfiguration: awslogs("/plain") }])).toEqual({
      group: "/plain",
    })
    expect(logGroupFrom(orders, [{ name: "orders", logConfiguration: { logDriver: "awsfirelens" } }])).toBeUndefined()
  })
})

describe("a service's lines from CloudWatch Logs", () => {
  test("are read from its task definition's group and prefix, in order, masked, with the task as their pod", () => {
    const calls: Call[] = []
    const page = {
      events: [
        event("2026-10-27T11:59:57Z", '{"level":"info","message":"basket 4031 updated"}'),
        event("2026-10-27T11:59:58Z", "ERROR card 4111111111111111 declined", "9a2e"),
      ],
    }
    return read(fakeAws(calls, [page])).then((result) => {
      expect(Result.isSuccess(result) && result.success).toEqual([
        {
          at: "2026-10-27T11:59:57.000Z",
          pod: "4f1c",
          level: "INFO",
          text: '{"level":"info","message":"basket 4031 updated"}',
        },
        { at: "2026-10-27T11:59:58.000Z", pod: "9a2e", level: "ERROR", text: "ERROR card ••• declined" },
      ])
      expect(bodiesOf(calls, "FilterLogEvents")).toEqual([
        {
          logGroupIdentifier: "/shop/production/orders",
          logStreamNamePrefix: "ecs/orders/",
          startTime: from,
          endTime: to,
          limit: 10_000,
        },
      ])
    })
  })

  test("follow CloudWatch's pages, and keep to the last minute when there are too many to follow", () => {
    const calls: Call[] = []
    const more = (at: string) => ({ events: [event(at, `INFO at ${at}`)], nextToken: "more" })
    const pages = [
      ...["11:50:00", "11:51:00", "11:52:00", "11:53:00", "11:54:00"].map((at) => more(`2026-10-27T${at}Z`)),
      { events: [event("2026-10-27T11:59:30Z", "INFO in the last minute")] },
    ]
    return read(fakeAws(calls, pages)).then((result) => {
      expect(Result.isSuccess(result) && result.success.map((line) => line.text)).toEqual(["INFO in the last minute"])
      const asked = bodiesOf(calls, "FilterLogEvents")
      expect(asked.map((body) => body.nextToken)).toEqual([undefined, "more", "more", "more", "more", undefined])
      expect(asked.at(-1)?.startTime).toBe(to - 60_000)
    })
  })

  test("keep the newest when more came than were asked for", () => {
    const page = {
      events: ["11:59:01", "11:59:02", "11:59:03"].map((at) => event(`2026-10-27T${at}Z`, `INFO ${at}`)),
    }
    return read(fakeAws([], [page]), orders, 2).then((result) =>
      expect(Result.isSuccess(result) && result.success.map((line) => line.text)).toEqual([
        "INFO 11:59:02",
        "INFO 11:59:03",
      ]),
    )
  })

  test("say where to name the group when the task logs through no awslogs container", () => {
    const firelens = [{ name: "orders", logConfiguration: { logDriver: "awsfirelens" } }]
    return read(fakeAws([], [], firelens)).then((result) =>
      expect(Result.isFailure(result) && result.failure.message).toBe(
        "orders's task definition logs through no awslogs container; set logs.cloudwatch.group",
      ),
    )
  })

  test("leave the region alone a while when CloudWatch says it is asked too often", () => {
    const throttled = (call: Call) =>
      call.headers?.["x-amz-target"] === "Logs_20140328.FilterLogEvents"
        ? reply({ __type: "ThrottlingException", message: "Rate exceeded" }, 400)
        : fakeAws([], [])(call)
    return Effect.runPromise(
      Effect.gen(function* () {
        const failed = yield* Effect.result(logsFor(section, orders)?.read(from, to, 10) ?? Effect.succeed([]))
        const after = yield* Effect.forkChild((yield* CloudwatchBudget).take("eu-west-2", 4))
        yield* TestClock.adjust("4 seconds")
        const waiting = after.pollUnsafe() === undefined
        yield* TestClock.adjust("2 seconds")
        return [Result.isFailure(failed) && failed.failure.message, waiting]
      }).pipe(
        Effect.provide(Layer.mergeAll(stubRemote(throttled), platform, cloudwatchBudgetLayer, TestClock.layer())),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ).then((answer) => expect(answer).toEqual(["CloudWatch Logs Rate exceeded (/shop/production/orders)", true]))
  })

  test("say which group they could not find, in CloudWatch's words", () => {
    const missing = (call: Call) =>
      call.headers?.["x-amz-target"] === "Logs_20140328.FilterLogEvents"
        ? reply({ __type: "ResourceNotFoundException", message: "The specified log group does not exist." }, 400)
        : fakeAws([], [])(call)
    return read(missing).then((result) =>
      expect(Result.isFailure(result) && result.failure.message).toBe(
        "CloudWatch Logs The specified log group does not exist. (/shop/production/orders)",
      ),
    )
  })

  test("are read a little behind the last line seen, as CloudWatch can make a line searchable late", () => {
    expect(logsFor(section, orders)?.overlap).toBe(10_000)
    expect(logsFor({ loki: { url: "http://loki" } }, orders)?.overlap).toBeUndefined()
  })

  test("are nothing for a service neither on ECS nor naming a group, and the catalog's group without ECS", () => {
    const elsewhere: Service = { name: "batch", environments: ["production"] }
    expect(logsFor(section, elsewhere)).toBeUndefined()
    expect(logsFor({ cloudwatchLogs: {} }, orders)).toBeUndefined()
    const calls: Call[] = []
    const named = { ...elsewhere, logs: { cloudwatch: { group: "/batch" } } }
    return read(fakeAws(calls, [{ events: [] }]), named).then(() => {
      expect(calls.map((call) => call.headers?.["x-amz-target"])).toEqual(["Logs_20140328.FilterLogEvents"])
      expect(bodiesOf(calls, "FilterLogEvents")[0]?.logGroupIdentifier).toBe("/batch")
    })
  })

  test("find the group once, however often they are read", () => {
    const calls: Call[] = []
    const logs = logsFor(section, orders)
    const twice = Effect.all([logs?.read(from, to, 10), logs?.read(from, to, 10)].flatMap((each) => each ?? []))
    return Effect.runPromise(
      twice.pipe(
        Effect.provide(Layer.merge(stubRemote(fakeAws(calls, [])), platform)),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ).then(() =>
      expect(calls.filter((call) => call.headers?.["x-amz-target"]?.endsWith(".DescribeTaskDefinition"))).toHaveLength(
        1,
      ),
    )
  })
})

describe("the account's budget of CloudWatch Logs calls", () => {
  test("lets six readers make no more than two calls a second between them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* CloudwatchBudget
        const made = yield* Ref.make(0)
        const fibers = yield* Effect.forEach([1, 2, 3, 4, 5, 6], () =>
          Effect.forkChild(
            Effect.andThen(
              budget.take("eu-west-2", 2),
              Ref.update(made, (count) => count + 1),
            ),
          ),
        )
        yield* TestClock.adjust("1 millis")
        const first = yield* Ref.get(made)
        yield* TestClock.adjust("1 second")
        const second = yield* Ref.get(made)
        yield* TestClock.adjust("1 second")
        const third = yield* Ref.get(made)
        yield* TestClock.adjust("1 second")
        yield* Fiber.joinAll(fibers)
        expect([first, second, third]).toEqual([1, 3, 5])
      }).pipe(Effect.provide(Layer.merge(cloudwatchBudgetLayer, TestClock.layer()))),
    ))

  test("waits longer after CloudWatch says it is asked too often", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* CloudwatchBudget
        yield* budget.backOff("eu-west-2")
        const taken = yield* Effect.forkChild(budget.take("eu-west-2", 4))
        yield* TestClock.adjust("4 seconds")
        expect(taken.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust("2 seconds")
        expect(taken.pollUnsafe()).toBeDefined()
      }).pipe(Effect.provide(Layer.merge(cloudwatchBudgetLayer, TestClock.layer()))),
    ))
})
