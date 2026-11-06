import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Result } from "effect"
import type { Service } from "../../shared/catalog"
import { type GcpJson, makeGcpJson } from "../gcp/json"
import { platform } from "../platform"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import {
  CloudLoggingBudget,
  cloudLoggingBudgetLayer,
  cloudLoggingFilterOf,
  cloudLoggingLines,
  cloudLoggingReader,
} from "./cloud-logging"

const orders: Service = {
  name: "orders",
  environments: ["production"],
  runtime: { cloudRun: { service: "orders-api" } },
  logs: { cloudLogging: { container: "app" } },
}

const sampleEntry = {
  insertId: "ins-1",
  timestamp: "2026-11-06T12:00:00.000Z",
  severity: "INFO",
  textPayload: "order 101 created",
  resource: {
    type: "cloud_run_revision",
    labels: { revision_name: "orders-api-00001" },
  },
}

const fakeLogging =
  (calls: Call[], entries: ReadonlyArray<unknown> = [sampleEntry]) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    if (call.url.includes("logging.googleapis.com/v2/entries:list")) {
      return reply({ entries })
    }
    return undefined
  }

const keys = ConfigProvider.fromUnknown({ GCP_ACCESS_TOKEN: "ya29.test-token" })

const withLogging = <A, E>(use: (gcp: GcpJson) => Effect.Effect<A, E>, answer: (call: Call) => Reply | undefined) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(makeGcpJson(), use).pipe(
        Effect.provide(Layer.merge(stubRemote(answer), platform)),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ),
  )

describe("Cloud Logging filter", () => {
  test("derives from cloudRun service name and container", () => {
    const filter = cloudLoggingFilterOf(orders)
    expect(filter).toBe(
      'resource.type="cloud_run_revision" AND resource.labels.service_name="orders-api" AND labels."run.googleapis.com/container_name"="app"',
    )
  })

  test("uses catalog custom filter when specified", () => {
    const custom: Service = {
      name: "orders",
      environments: ["production"],
      logs: { cloudLogging: { filter: 'resource.type="gke_container"' } },
    }
    expect(cloudLoggingFilterOf(custom)).toBe('resource.type="gke_container"')
  })
})

describe("Cloud Logging lines", () => {
  test("reads entries from entries:list, sorts oldest first and extracts pod", () => {
    const calls: Call[] = []
    const from = Date.parse("2026-11-06T11:55:00Z")
    const to = Date.parse("2026-11-06T12:00:00Z")
    return withLogging(
      (gcp) => cloudLoggingLines(gcp, "my-proj", 'resource.type="cloud_run_revision"', from, to, 50),
      fakeLogging(calls),
    ).then((result) => {
      const lines = Result.isSuccess(result) ? result.success : []
      expect(lines).toHaveLength(1)
      expect(lines[0]).toEqual({
        at: "2026-11-06T12:00:00.000Z",
        pod: "orders-api-00001",
        level: "INFO",
        text: "order 101 created",
      })
      expect(calls[0]?.url).toContain("logging.googleapis.com/v2/entries:list")
      const body = JSON.parse(calls[0]?.body ?? "{}")
      expect(body.resourceNames).toEqual(["projects/my-proj"])
      expect(body.pageSize).toBe(50)
      expect(body.filter).toContain('resource.type="cloud_run_revision"')
    })
  })

  test("cloudLoggingReader reads lines using configured GCP project and filter", () => {
    const calls: Call[] = []
    const from = Date.parse("2026-11-06T11:55:00Z")
    const to = Date.parse("2026-11-06T12:00:00Z")
    const reader = cloudLoggingReader({ project: "my-proj", region: "europe-west2" }, { callsPerSecond: 5 }, orders)
    expect(reader).toBeDefined()
    if (reader === undefined) return Promise.resolve()
    return Effect.runPromise(
      reader(from, to, 50).pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
        Effect.provide(Layer.mergeAll(stubRemote(fakeLogging(calls)), platform, cloudLoggingBudgetLayer)),
      ),
    ).then((lines) => {
      expect(lines).toHaveLength(1)
      expect(lines[0]?.text).toBe("order 101 created")
    })
  })

  test("cloudLoggingBudgetLayer paces calls according to callsPerSecond", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const budget = yield* CloudLoggingBudget
        yield* budget.take("my-proj", 10)
        yield* budget.backOff("my-proj")
      }).pipe(Effect.provide(Layer.merge(cloudLoggingBudgetLayer, platform))),
    ))

  test("handles jsonPayload messages, missing severity, and 429 rate limit backoff", () => {
    const entries = [
      { insertId: "1", timestamp: "2026-11-06T12:00:00Z", jsonPayload: { message: "json msg" } },
      { insertId: "2", timestamp: "2026-11-06T12:01:00Z", jsonPayload: { data: 123 }, labels: { instanceId: "i-1" } },
    ]
    const readEntries = withLogging(
      (gcp) => cloudLoggingLines(gcp, "proj", "filter", 0, 1000, 10),
      fakeLogging([], entries),
    )
    const rateLimited = withLogging(
      (gcp) => cloudLoggingLines(gcp, "proj", "filter", 0, 1000, 10),
      () => reply({ error: { code: 429, message: "rate limit exceeded" } }, 429),
    )
    return Promise.all([readEntries, rateLimited]).then(([linesRes, rateRes]) => {
      expect(Result.isSuccess(linesRes)).toBe(true)
      if (Result.isSuccess(linesRes)) {
        expect(linesRes.success).toHaveLength(2)
        expect(linesRes.success[0]?.text).toBe("json msg")
        expect(linesRes.success[1]?.pod).toBe("i-1")
      }
      expect(Result.isFailure(rateRes)).toBe(true)
    })
  })
})
