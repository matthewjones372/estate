import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers"
import { type AwsJson, makeAwsJson } from "../src/server/aws/json"
import { platform } from "../src/server/platform"
import { liveRemote } from "../src/server/remote"
import { cloudwatchApi, readAlarms } from "../src/server/sources/cloudwatch"
import { urlOf } from "./real"

let localstack: StartedTestContainer

const keys = ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test" })

/** Runs `use` with Estate's own CloudWatch caller, signed as Estate signs its calls, against LocalStack. */
const withCloudWatch = <A, E>(use: (cloudwatch: AwsJson) => Effect.Effect<A, E, never>): Promise<A> =>
  Effect.runPromise(
    Effect.flatMap(makeAwsJson(cloudwatchApi, "eu-west-2", urlOf(localstack, 4566)), use).pipe(
      Effect.provide(Layer.merge(liveRemote, platform)),
      Effect.provideService(ConfigProvider.ConfigProvider, keys),
    ),
  )

const checkout = [{ Name: "ServiceName", Value: "checkout" }]

beforeAll(async () => {
  localstack = await new GenericContainer("public.ecr.aws/localstack/localstack:4.9")
    .withEnvironment({ SERVICES: "cloudwatch" })
    .withExposedPorts(4566)
    .withWaitStrategy(Wait.forLogMessage(/Ready\./))
    .withStartupTimeout(120_000)
    .start()
  const now = Math.floor(Date.now() / 1000)
  await withCloudWatch((cloudwatch) =>
    Effect.gen(function* () {
      // Checkout's latency over the last ten minutes, a point a minute, climbing.
      yield* cloudwatch("PutMetricData", {
        Namespace: "Shop",
        MetricData: Array.from({ length: 10 }, (_, minute) => ({
          MetricName: "Latency",
          Dimensions: checkout,
          Timestamp: now - (10 - minute) * 60,
          Value: 100 + minute * 20,
        })),
      })
      const alarm = (AlarmName: string, Dimensions: typeof checkout) => ({
        AlarmName,
        AlarmDescription: `${AlarmName} for checkout`,
        Namespace: "Shop",
        MetricName: "Latency",
        Dimensions,
        Statistic: "Average",
        Period: 60,
        EvaluationPeriods: 1,
        Threshold: 250,
        ComparisonOperator: "GreaterThanThreshold",
      })
      yield* cloudwatch("PutMetricAlarm", alarm("CheckoutSlow", checkout))
      yield* cloudwatch("PutMetricAlarm", alarm("SearchSlow", [{ Name: "ServiceName", Value: "search" }]))
      yield* cloudwatch("PutMetricAlarm", alarm("OrdersSlow", [{ Name: "ServiceName", Value: "orders" }]))
      // How an on-call engineer tests an alarm: CloudWatch's own SetAlarmState.
      yield* cloudwatch("SetAlarmState", { AlarmName: "CheckoutSlow", StateValue: "ALARM", StateReason: "testing" })
      yield* cloudwatch("SetAlarmState", { AlarmName: "OrdersSlow", StateValue: "OK", StateReason: "testing" })
      yield* cloudwatch("SetAlarmState", {
        AlarmName: "SearchSlow",
        StateValue: "INSUFFICIENT_DATA",
        StateReason: "testing",
      })
    }),
  )
})

afterAll(async () => {
  await localstack?.stop()
})

// LocalStack's CloudWatch answers GetMetricData for MetricStat queries only, and Estate's are expressions (SEARCH,
// metric math, Metrics Insights), so load from CloudWatch is checked against a real account with `estate doctor`.
describe("CloudWatch, as LocalStack plays it", () => {
  test("gives an alarm in ALARM as firing about its service, and one without data as pending; OK is not an alert", async () => {
    const alerts = await withCloudWatch(readAlarms)
    expect(alerts.map((alert) => [alert.name, alert.state, alert.labels["service"]]).sort()).toEqual([
      ["CheckoutSlow", "firing", "checkout"],
      ["SearchSlow", "pending", "search"],
    ])
    expect(alerts.find((alert) => alert.name === "CheckoutSlow")).toMatchObject({
      summary: "CheckoutSlow for checkout",
      expression: `SELECT AVG(Latency) FROM SCHEMA("Shop", ServiceName) WHERE ServiceName = 'checkout' > 250`,
    })
  })
})
