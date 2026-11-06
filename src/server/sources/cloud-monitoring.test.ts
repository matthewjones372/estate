import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Result } from "effect"
import { type GcpJson, makeGcpJson } from "../gcp/json"
import { platform } from "../platform"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import { cloudMonitoringRanges, readCloudMonitoringAlerts } from "./cloud-monitoring"

const cpuPolicy = {
  name: "projects/p/alertPolicies/123",
  displayName: "OrdersCpuHigh",
  documentation: { content: "Orders CPU usage is high" },
  userLabels: { service: "orders", severity: "warning" },
  conditions: [
    {
      displayName: "CPU condition",
      conditionThreshold: {
        filter:
          'resource.type = "cloud_run_revision" AND metric.type = "run.googleapis.com/container/cpu/utilizations"',
        comparison: "COMPARISON_GT",
        thresholdValue: 0.8,
      },
    },
  ],
  enabled: true,
}

const otherPolicies = [
  {
    ...cpuPolicy,
    name: "projects/p/alertPolicies/124",
    displayName: "OrdersMem",
    conditions: [
      {
        displayName: "Mem",
        conditionThreshold: { filter: "m", comparison: "COMPARISON_GE", thresholdValue: 0.9 },
      },
    ],
  },
  {
    ...cpuPolicy,
    name: "projects/p/alertPolicies/125",
    displayName: "OrdersDisk",
    conditions: [
      {
        displayName: "Disk",
        conditionThreshold: { filter: "d", comparison: "COMPARISON_LT", thresholdValue: 0.1 },
      },
    ],
  },
  {
    ...cpuPolicy,
    name: "projects/p/alertPolicies/126",
    displayName: "OrdersIO",
    conditions: [
      {
        displayName: "IO",
        conditionThreshold: { filter: "i", comparison: "COMPARISON_LE", thresholdValue: 0.05 },
      },
    ],
  },
]

const fakeMonitoring =
  (calls: Call[]) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    if (call.url.includes("/alertPolicies")) {
      return reply({ alertPolicies: [cpuPolicy, ...otherPolicies] })
    }
    if (call.url.includes("/api/v1/query_range")) {
      return reply({
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: { service: "orders" },
              values: [
                [1762430400, "10"],
                [1762430460, "12"],
              ],
            },
          ],
        },
      })
    }
    if (call.url.includes("/api/v1/query?")) {
      return reply({
        status: "success",
        data: {
          resultType: "vector",
          result: [
            {
              metric: { service: "orders" },
              value: [1762430460, "42"],
            },
          ],
        },
      })
    }
    if (call.url.includes("/api/v1/rules")) {
      return reply({
        status: "success",
        data: {
          groups: [
            {
              rules: [{ name: "OrdersCpuHigh", query: "orders_cpu > 0.8", type: "alerting" }],
            },
          ],
        },
      })
    }
    return undefined
  }

const keys = ConfigProvider.fromUnknown({ GCP_ACCESS_TOKEN: "ya29.test-token" })

const withGcp = <A, E>(use: (gcp: GcpJson) => Effect.Effect<A, E>, answer: (call: Call) => Reply | undefined) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(makeGcpJson(), use).pipe(
        Effect.provide(Layer.merge(stubRemote(answer), platform)),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ),
  )

describe("Cloud Monitoring alerts", () => {
  test("are active alert policies mapped to firing alerts", () => {
    const calls: Call[] = []
    const ok = withGcp((gcp) => readCloudMonitoringAlerts(gcp, "p"), fakeMonitoring(calls)).then((result) => {
      const alerts = Result.isSuccess(result) ? result.success : []
      expect(alerts).toHaveLength(4)
      expect(alerts[0]).toMatchObject({
        name: "OrdersCpuHigh",
        state: "firing",
        severity: "warning",
        summary: "Orders CPU usage is high",
        labels: { alertname: "OrdersCpuHigh", service: "orders" },
      })
      expect(alerts[0]?.expression).toContain('metric.type = "run.googleapis.com/container/cpu/utilizations" > 0.8')
    })
    const failing = withGcp(
      (gcp) => readCloudMonitoringAlerts(gcp, "p"),
      () => reply({ error: { code: 500, message: "failed" } }, 500),
    ).then((result) => {
      expect(Result.isFailure(result)).toBe(true)
    })
    return Promise.all([ok, failing])
  })
})

describe("Cloud Monitoring metrics (Managed Service for Prometheus)", () => {
  test("queries range over Prometheus endpoint with Bearer auth", () => {
    const calls: Call[] = []
    const creds = ConfigProvider.fromUnknown({ GCP_ACCESS_TOKEN: "ya29.test-token" })
    return Effect.runPromise(
      makeGcpJson().pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, creds),
        Effect.provide(Layer.merge(stubRemote(fakeMonitoring(calls)), platform)),
      ),
    ).then((gcpJson) => {
      const ranges = cloudMonitoringRanges(
        "p",
        gcpJson,
        "https://monitoring.googleapis.com/v1/projects/p/location/global/prometheus",
      )
      const prov = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
        eff.pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, creds),
          Effect.provide(Layer.merge(stubRemote(fakeMonitoring(calls)), platform)),
        )
      return Effect.runPromise(prov(ranges.range("sum(orders_total)", { seconds: 120, step: 60 }, 1762430460000)))
        .then((series) => {
          expect(series.now).toBe(12)
          expect(calls[0]?.url).toContain("/api/v1/query_range")
          expect(calls[0]?.headers?.["authorization"]).toBe("Bearer ya29.test-token")
        })
        .then(() =>
          Effect.runPromise(prov(ranges.instant?.("orders_total") ?? Effect.succeed([]))).then((readings) => {
            expect(readings).toHaveLength(1)
            expect(readings[0]?.value).toBe(42)
            return Effect.runPromise(prov(ranges.labels?.("orders_total") ?? Effect.succeed([]))).then((labels) => {
              expect(labels).toHaveLength(1)
              expect(labels[0]?.["service"]).toBe("orders")
              return Effect.runPromise(prov(ranges.rules)).then((rules) => {
                expect(rules.get("OrdersCpuHigh")).toBe("orders_cpu > 0.8")
              })
            })
          }),
        )
    })
  })
})
