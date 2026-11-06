import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Result } from "effect"
import type { Service } from "../../shared/catalog"
import { type GcpJson, makeGcpJson } from "../gcp/json"
import { platform } from "../platform"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import { cloudRunJobOf, readCloudRunDeploys, readCloudRunWorkloads } from "./cloud-run"
import { cloudRunJobs } from "./standalone"

const orders: Service = {
  name: "orders",
  environments: ["staging"],
  runtime: { cloudRun: { service: "orders-svc", region: "europe-west2" } },
  jobs: [{ kind: "CloudRunJob", name: "orders-sync" }],
}

const revision = (
  name: string,
  state = "CONDITION_SUCCEEDED",
  image = "europe-west2-docker.pkg.dev/proj/repo/orders:v2.5.0",
) => ({
  name: `projects/p/locations/europe-west2/services/orders-svc/revisions/${name}`,
  createTime: "2026-11-06T10:00:00Z",
  containers: [{ image }],
  conditions: [{ type: "Ready", state }],
})

const fakeGcp =
  (calls: Call[], deployState = "CONDITION_SUCCEEDED", deployReason?: string) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    if (call.url.includes("/services/orders-svc/revisions")) {
      return reply({
        revisions: [
          revision("orders-svc-00001", "CONDITION_SUCCEEDED"),
          revision("orders-svc-00002", "CONDITION_FAILED"),
        ],
      })
    }
    if (call.url.includes("/services/orders-svc")) {
      return reply({
        name: "projects/p/locations/europe-west2/services/orders-svc",
        latestReadyRevision:
          deployState === "CONDITION_SUCCEEDED"
            ? "projects/p/locations/europe-west2/services/orders-svc/revisions/orders-svc-00001"
            : undefined,
        latestCreatedRevision: "projects/p/locations/europe-west2/services/orders-svc/revisions/orders-svc-00001",
        terminalCondition: { state: deployState, message: deployReason },
        template: {
          containers: [{ image: "europe-west2-docker.pkg.dev/proj/repo/orders:v2.5.0" }],
        },
        updateTime: "2026-11-06T11:40:00Z",
      })
    }
    if (call.url.includes("/jobs/orders-sync/executions")) {
      return reply({
        executions: [
          {
            name: "projects/p/locations/europe-west2/jobs/orders-sync/executions/run-1",
            createTime: "2026-11-06T02:00:00Z",
            completionTime: "2026-11-06T02:05:00Z",
            succeededCount: 1,
            conditions: [{ type: "Completed", state: "CONDITION_SUCCEEDED" }],
          },
          {
            name: "projects/p/locations/europe-west2/jobs/orders-sync/executions/run-2",
            createTime: "2026-11-06T03:00:00Z",
            completionTime: "2026-11-06T03:02:00Z",
            failedCount: 1,
            conditions: [{ type: "Completed", state: "CONDITION_FAILED", message: "Out of memory" }],
          },
        ],
      })
    }
    return undefined
  }

const keys = ConfigProvider.fromUnknown({ GCP_ACCESS_TOKEN: "ya29.test-token" })

const withCloudRun = <A, E>(use: (gcp: GcpJson) => Effect.Effect<A, E>, answer: (call: Call) => Reply | undefined) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(makeGcpJson(), use).pipe(
        Effect.provide(Layer.merge(stubRemote(answer), platform)),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ),
  )

describe("services on Cloud Run", () => {
  test("are active revisions, ready unless failed, and their jobs' executions", () => {
    const calls: Call[] = []
    return withCloudRun((gcp) => readCloudRunWorkloads(gcp, "proj", "europe-west2", [orders]), fakeGcp(calls)).then(
      (result) => {
        const workloads = Result.isSuccess(result) ? result.success : undefined
        expect(workloads?.pods["orders"]).toEqual([
          {
            name: "orders-svc-00001",
            phase: "RUNNING",
            ready: true,
            restarts: 0,
            image: "europe-west2-docker.pkg.dev/proj/repo/orders:v2.5.0",
            startedAt: "2026-11-06T10:00:00Z",
          },
          {
            name: "orders-svc-00002",
            phase: "FAILED",
            ready: false,
            restarts: 0,
            image: "europe-west2-docker.pkg.dev/proj/repo/orders:v2.5.0",
            startedAt: "2026-11-06T10:00:00Z",
          },
        ])
        expect(workloads?.jobs?.["orders"]?.[0]).toEqual({
          name: "orders-sync",
          kind: "CloudRunJob",
          suspended: false,
          runs: [
            {
              name: "run-1",
              outcome: "succeeded",
              startedAt: "2026-11-06T02:00:00Z",
              finishedAt: "2026-11-06T02:05:00Z",
            },
            {
              name: "run-2",
              outcome: "failed",
              startedAt: "2026-11-06T03:00:00Z",
              finishedAt: "2026-11-06T03:02:00Z",
              message: "Out of memory",
            },
          ],
        })
      },
    )
  })

  test("deploys reflect latest ready revision and image tag", () => {
    const calls: Call[] = []
    return withCloudRun((gcp) => readCloudRunDeploys(gcp, "proj", "europe-west2", [orders]), fakeGcp(calls)).then(
      (result) => {
        const deploys = Result.isSuccess(result) ? result.success : undefined
        expect(deploys?.["orders"]).toEqual({
          version: "v2.5.0",
          ready: true,
          at: "2026-11-06T11:40:00Z",
        })
      },
    )
  })

  test("deploys report stalled message when terminal condition failed", () => {
    const calls: Call[] = []
    return withCloudRun(
      (gcp) => readCloudRunDeploys(gcp, "proj", "europe-west2", [orders]),
      fakeGcp(calls, "CONDITION_FAILED", "Revision failed to start container"),
    ).then((result) => {
      const deploys = Result.isSuccess(result) ? result.success : undefined
      expect(deploys?.["orders"]?.ready).toBe(false)
      expect(deploys?.["orders"]?.stalled).toBe("Revision failed to start container")
    })
  })

  test("cloudRunJobOf reads job executions standalone", () => {
    const calls: Call[] = []
    return withCloudRun((gcp) => cloudRunJobOf(gcp, "proj", "europe-west2", "orders-sync"), fakeGcp(calls)).then(
      (result) => {
        const job = Result.isSuccess(result) ? result.success : undefined
        expect(job?.name).toBe("orders-sync")
        expect(job?.runs).toHaveLength(2)
        expect(job?.runs[0]?.outcome).toBe("succeeded")
      },
    )
  })

  test("cloudRunJobs reads executions of standalone jobs", () => {
    const calls: Call[] = []
    const job = {
      name: "orders-cleaner",
      environments: ["staging"],
      run: { cloudRun: { job: "orders-sync" } },
    }
    return withCloudRun((gcp) => cloudRunJobs(gcp, "proj", "europe-west2", [job]), fakeGcp(calls)).then((result) => {
      const jobs = Result.isSuccess(result) ? result.success : {}
      expect(jobs["orders-cleaner"]).toHaveLength(1)
      expect(jobs["orders-cleaner"]?.[0]?.name).toBe("orders-cleaner")
    })
  })
})
