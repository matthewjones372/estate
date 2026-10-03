import { describe, expect, test } from "bun:test"
import type { StandaloneJob } from "../../shared/catalog"
import type { Job } from "../../shared/events"
import { catalog, environment, estate } from "../fixture"
import type { SourcedAlert } from "../state"
import { catalogView } from "./catalog"
import { jobHealthOf } from "./jobs"
import { servicesView } from "./services"

const settle: StandaloneJob = {
  name: "settle",
  category: "Payments",
  environments: ["production"],
  run: { kubernetes: { namespace: "batch", cronJob: "nightly-settle" } },
  links: { logs: "https://logs.example/{env}/{namespace}/{job}" },
}
const run = (outcome: "succeeded" | "failed" | "running", message?: string) => ({
  name: `settle-${outcome}`,
  outcome,
  startedAt: "2026-10-03T02:00:00Z",
  ...(message === undefined ? {} : { message }),
})
const read = (job: Partial<Job>): Job => ({
  name: "nightly-settle",
  kind: "CronJob",
  suspended: false,
  runs: [],
  ...job,
})
const withJob = (job: Job | undefined, alerts: ReadonlyArray<SourcedAlert> = []) =>
  environment({
    cluster: { state: "ok", value: { pods: {}, debug: {}, jobs: job === undefined ? {} : { settle: [job] } } },
    alerts: { state: "ok", value: alerts },
  })
const alert = (severity: string): SourcedAlert => ({
  id: severity,
  name: `Settle${severity}`,
  state: "firing",
  severity,
  startsAt: "2026-10-03T02:00:00Z",
  labels: { service: "settle" },
})

describe("a job no service owns", () => {
  test("is healthy when its last finished run succeeded, even while the next runs", () => {
    expect(jobHealthOf(settle, withJob(read({ runs: [run("running"), run("succeeded")] })))).toMatchObject({
      health: "healthy",
      reasons: [],
    })
  })

  test("needs someone when its last run failed, it missed a run, it is not there, or an alert about it fires", () => {
    const failed = jobHealthOf(settle, withJob(read({ runs: [run("failed", "BackoffLimitExceeded")], missed: "t" })))
    expect(failed).toMatchObject({
      health: "attention",
      reasons: ["its last run failed: BackoffLimitExceeded", "it missed a run"],
    })
    expect(
      jobHealthOf(settle, withJob(read({ absent: "the cluster has no CronJob nightly-settle in batch" }))).reasons,
    ).toEqual(["the cluster has no CronJob nightly-settle in batch"])
    expect(
      jobHealthOf(settle, withJob(read({ runs: [run("failed")] }), [alert("critical"), alert("warning")])),
    ).toMatchObject({
      health: "critical",
      reasons: ["Settlecritical is firing", "Settlewarning is firing", "its last run failed"],
    })
  })

  test("is not claimed healthy before it has been read", () => {
    expect(jobHealthOf(settle, withJob(undefined))).toEqual({ health: "unknown", reasons: ["not read yet"] })
  })

  test("is in the catalog event with its links, and in the services event with its health, counted in the worst", () => {
    const withJobs = { ...catalog, jobs: [settle] }
    const view = catalogView(withJobs, "production")
    expect(view.jobs).toEqual([
      {
        name: "settle",
        category: "Payments",
        kind: "CronJob",
        links: [{ name: "logs", url: "https://logs.example/production/batch/settle" }],
      },
    ])
    expect(catalogView(withJobs, "staging").jobs).toEqual([])
    const failing = withJob(read({ runs: [run("failed")] }))
    const services = servicesView(estate({ catalog: withJobs, environments: { production: failing } }), "production")
    expect(services.jobs?.[0]).toMatchObject({ name: "settle", health: "attention" })
    expect(services.environments.find((each) => each.name === "production")?.worst).not.toBe("healthy")
    expect(servicesView(estate(), "production").jobs).toBeUndefined()
  })
})
