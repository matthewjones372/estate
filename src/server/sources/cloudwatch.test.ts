import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Result, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import type { Catalog } from "../../shared/catalog"
import { type AwsJson, makeAwsJson } from "../aws/json"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, type Remote, type Reply, reply, stubRemote } from "../remote"
import { Estate, estateLayer } from "../state"
import { cloudwatchApi, cloudwatchRanges, comparisonOf, readAlarms } from "./cloudwatch"
import { startSources } from "./start"

const now = Date.parse("2026-10-03T12:00:00Z")
const seconds = (at: string) => Date.parse(at) / 1000

const cpu = {
  AlarmName: "OrdersCpuHigh",
  AlarmDescription: "Orders is using most of its CPU",
  StateValue: "ALARM",
  StateUpdatedTimestamp: seconds("2026-10-03T11:46:00Z"),
  Namespace: "AWS/ECS",
  MetricName: "CPUUtilization",
  Statistic: "Average",
  Dimensions: [
    { Name: "ClusterName", Value: "shop" },
    { Name: "ServiceName", Value: "orders" },
  ],
  Threshold: 80,
  ComparisonOperator: "GreaterThanThreshold",
}

/** CloudWatch as a stub: two pages of alarms, and a metric's points by its query. */
const fakeCloudWatch =
  (calls: Call[]) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    const operation = call.headers?.["x-amz-target"]?.split(".")[1]
    const body = JSON.parse(call.body ?? "{}")
    if (operation === "DescribeAlarms")
      return body.NextToken === undefined
        ? reply({ MetricAlarms: [cpu, { ...cpu, AlarmName: "Quiet", StateValue: "OK" }], NextToken: "2" })
        : reply({
            MetricAlarms: [
              { AlarmName: "QueueStale", StateValue: "INSUFFICIENT_DATA", Metrics: [], StateUpdatedTimestamp: 0 },
            ],
          })
    if (operation === "GetMetricData") {
      const end = body.EndTime - body.MetricDataQueries[0].Period
      const value = String(body.MetricDataQueries[0].Expression).includes("CPUUtilization") ? 91 : 12
      return reply({ MetricDataResults: [{ Timestamps: [end - 60, end], Values: [value - 1, value] }] })
    }
    return undefined
  }

const keys = ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "secret" })

const withCloudWatch = <A, E>(
  use: (cloudwatch: AwsJson) => Effect.Effect<A, E, Remote>,
  answer: (call: Call) => Reply | undefined,
) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(makeAwsJson(cloudwatchApi, "eu-west-2"), use).pipe(
        Effect.provide(Layer.merge(stubRemote(answer), platform)),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ),
  )

describe("CloudWatch alarms", () => {
  test("are alerts, ALARM firing and INSUFFICIENT_DATA pending, about the service their dimensions name", () => {
    const calls: Call[] = []
    return withCloudWatch(readAlarms, fakeCloudWatch(calls)).then((result) => {
      const alerts = Result.isSuccess(result) ? result.success : []
      expect(alerts.map((alert) => [alert.name, alert.state])).toEqual([
        ["OrdersCpuHigh", "firing"],
        ["QueueStale", "pending"],
      ])
      expect(alerts[0]).toMatchObject({
        severity: "warning",
        summary: "Orders is using most of its CPU",
        startsAt: "2026-10-03T11:46:00.000Z",
        labels: { alertname: "OrdersCpuHigh", ServiceName: "orders", service: "orders", ClusterName: "shop" },
      })
      expect(calls[0]?.url).toBe("https://monitoring.eu-west-2.amazonaws.com/")
      expect(calls[0]?.headers?.["x-amz-target"]).toBe("GraniteServiceVersion20100801.DescribeAlarms")
    })
  })

  test("on one metric carry a Metrics Insights query held to their threshold; metric math does not", () => {
    expect(comparisonOf(cpu)).toBe(
      `SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/ECS", ClusterName, ServiceName) WHERE ClusterName = 'shop' AND ServiceName = 'orders' > 80`,
    )
    expect(comparisonOf({ ...cpu, Dimensions: [], ComparisonOperator: "LessThanOrEqualToThreshold" })).toBe(
      `SELECT AVG(CPUUtilization) FROM SCHEMA("AWS/ECS") <= 80`,
    )
    expect(comparisonOf({ ...cpu, Dimensions: [{ Name: "Queue", Value: "o'reilly" }] })).toContain(
      "Queue = 'o''reilly'",
    )
    expect(comparisonOf({ ...cpu, Statistic: undefined } as never)).toBeUndefined()
    expect(comparisonOf({ ...cpu, Threshold: undefined } as never)).toBeUndefined()
  })

  test("say what CloudWatch said when it refuses, or answers in another shape", () =>
    Promise.all([
      withCloudWatch(readAlarms, () =>
        reply({ __type: "AccessDenied", message: "not allowed to DescribeAlarms" }, 400),
      ),
      withCloudWatch(readAlarms, () => reply({ odd: true })),
    ]).then(([refused, odd]) => {
      expect(Result.isFailure(refused) && refused.failure.message).toBe("CloudWatch not allowed to DescribeAlarms")
      expect(Result.isFailure(odd) && odd.failure.message).toBe(
        "CloudWatch answered DescribeAlarms in a shape Estate does not know",
      )
    }))
})

describe("CloudWatch metrics", () => {
  test("answer a query over a range on an even grid, a point a step", () => {
    const calls: Call[] = []
    return withCloudWatch(
      (cloudwatch) => cloudwatchRanges(cloudwatch).range("SELECT SUM(x) FROM y", { seconds: 600, step: 60 }, now),
      fakeCloudWatch(calls),
    ).then((result) => {
      const series = Result.isSuccess(result) ? result.success : undefined
      expect(series?.now).toBe(12)
      expect(series?.points).toHaveLength(11)
      expect(series?.points.slice(-2)).toEqual([11, 12])
      expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
        MetricDataQueries: [{ Id: "estate", Expression: "SELECT SUM(x) FROM y", Period: 60, ReturnData: true }],
        StartTime: now / 1000 - 600,
        EndTime: now / 1000 + 60,
      })
    })
  })

  test("are empty where CloudWatch has no points", () =>
    withCloudWatch(
      (cloudwatch) => cloudwatchRanges(cloudwatch).range("x", { seconds: 120, step: 60 }, now),
      () => reply({ MetricDataResults: [] }),
    ).then((result) => {
      expect(Result.isSuccess(result) && result.success).toEqual({ now: null, points: [null, null, null] })
    }))
})

describe("an estate on ECS with no Prometheus", () => {
  const onEcs: Catalog = {
    ...catalog,
    services: [
      {
        name: "orders",
        environments: ["staging"],
        runtime: { ecs: { cluster: "shop", service: "orders" } },
        load: { requests: 'SELECT SUM(RequestCount) FROM SCHEMA("AWS/ApplicationELB", LoadBalancer)' },
      },
    ],
    vitals: [{ title: "Orders", query: 'SELECT SUM(OrdersPlaced) FROM SCHEMA("Shop")', unit: "/s" }],
  }
  const configured = {
    ...settings({ anonymous: { name: "visitor", role: "viewer" } }),
    sources: { staging: { aws: { region: "eu-west-2" } }, production: {} },
  }
  const answer = (call: Call) =>
    call.headers?.["x-amz-target"]?.startsWith("AmazonEC2ContainerService")
      ? reply({ taskArns: [], services: [] })
      : fakeCloudWatch([])(call)

  test("shows its alarms with their charts, its load and its vitals", () => {
    const program = Effect.gen(function* () {
      yield* Effect.forkChild(startSources(configured))
      yield* TestClock.adjust("25 seconds")
      return (yield* SubscriptionRef.get(yield* Estate)).environments["staging"]
    })
    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(estateLayer(estate({ catalog: onEcs })), TestClock.layer(), stubRemote(answer), platform),
        ),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ).then((staging) => {
      const firing = staging?.alerts.value?.find((alert) => alert.name === "OrdersCpuHigh")
      expect(firing?.state).toBe("firing")
      expect(staging?.metrics.value?.services["orders"]?.requests?.now).toBe(12)
      expect(staging?.metrics.value?.vitals[0]?.now).toBe(12)
      const chart = staging?.metrics.value?.charts[firing?.id ?? ""]
      expect(chart?.threshold).toBe(80)
      expect(chart?.points.at(-1)).toBe(91)
    })
  })

  test("reads load over a longer range from CloudWatch too", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured, estate({ catalog: onEcs }), answer)
        return yield* ask(server, new Request("http://estate/api/load?env=staging&service=orders&range=6h"))
      }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, keys)),
    ).then((answered) => {
      expect(answered.json()).toMatchObject({ requests: { now: 12 } })
    }))
})
