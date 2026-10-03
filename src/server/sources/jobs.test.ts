import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { environment, estate, storefront } from "../fixture"
import { reply, stubRemote } from "../remote"
import { feedView } from "../views/feed"
import { healthOf } from "../views/health"
import { readCluster } from "./cluster"
import { jobsOf, nextRun, runOf } from "./jobs"
import { kubernetesJobs } from "./standalone"

const now = Date.parse("2026-10-03T12:20:00Z")
const cluster = { url: "https://cluster", headers: {} }
const failed = {
  type: "Failed",
  status: "True",
  reason: "BackoffLimitExceeded",
  message: "Job has reached the specified backoff limit",
  lastTransitionTime: "2026-10-03T11:03:00Z",
}
const job = (name: string, startTime: string, status: Record<string, unknown>, owner = "storefront-sitemap") => ({
  metadata: { name, ownerReferences: [{ kind: "CronJob", name: owner }] },
  status: { startTime, ...status },
})

const answers: Readonly<Record<string, unknown>> = {
  "https://cluster/apis/batch/v1/namespaces/shop/cronjobs/storefront-sitemap": {
    spec: { schedule: "0 * * * *" },
    status: { lastScheduleTime: "2026-10-03T11:00:00Z" },
  },
  "https://cluster/apis/batch/v1/namespaces/shop/jobs": {
    items: [
      job("storefront-sitemap-10", "2026-10-03T10:00:00Z", { succeeded: 1, completionTime: "2026-10-03T10:01:30Z" }),
      job("storefront-sitemap-11", "2026-10-03T11:00:00Z", { conditions: [failed] }),
      job("other-1", "2026-10-03T11:00:00Z", { active: 1 }, "other"),
    ],
  },
  "https://cluster/apis/batch/v1/namespaces/shop/jobs/storefront-migrate": job(
    "storefront-migrate",
    "2026-10-03T12:19:00Z",
    { active: 1 },
  ),
}

const shop = {
  ...storefront,
  kubernetes: { namespace: "shop", workloads: [] },
  jobs: [
    { kind: "CronJob" as const, name: "storefront-sitemap" },
    { kind: "Job" as const, name: "storefront-migrate" },
  ],
}

const read = Effect.runPromise(
  Effect.result(
    jobsOf(cluster, shop, now).pipe(
      Effect.provide(stubRemote((call) => (answers[call.url] === undefined ? undefined : reply(answers[call.url])))),
    ),
  ),
)

describe("jobs", () => {
  test("a CronJob's runs, newest first, how each ended, and the run its schedule missed", () =>
    read.then((result) => {
      const [cron, migrate] = Result.isSuccess(result) ? result.success : []
      expect(cron).toEqual({
        name: "storefront-sitemap",
        kind: "CronJob",
        schedule: "0 * * * *",
        suspended: false,
        runs: [
          {
            name: "storefront-sitemap-11",
            outcome: "failed",
            startedAt: "2026-10-03T11:00:00Z",
            finishedAt: "2026-10-03T11:03:00Z",
            message: "Job has reached the specified backoff limit",
          },
          {
            name: "storefront-sitemap-10",
            outcome: "succeeded",
            startedAt: "2026-10-03T10:00:00Z",
            finishedAt: "2026-10-03T10:01:30Z",
          },
        ],
        next: "2026-10-03T13:00:00.000Z",
        missed: "2026-10-03T12:00:00.000Z",
      })
      expect(migrate).toEqual({
        name: "storefront-migrate",
        kind: "Job",
        suspended: false,
        runs: [{ name: "storefront-migrate", outcome: "running", startedAt: "2026-10-03T12:19:00Z" }],
      })
    }))

  test("a suspended CronJob misses nothing and has no next run", () =>
    Effect.runPromise(
      jobsOf(cluster, { ...shop, jobs: [shop.jobs[0] ?? { kind: "CronJob", name: "" }] }, now).pipe(
        Effect.provide(
          stubRemote((call) => {
            const body = call.url.endsWith("/cronjobs/storefront-sitemap")
              ? { spec: { schedule: "0 * * * *", suspend: true }, status: { lastScheduleTime: "2026-10-01T00:00:00Z" } }
              : answers[call.url]
            return body === undefined ? undefined : reply(body)
          }),
        ),
      ),
    ).then(([job]) => {
      expect(job?.missed).toBeUndefined()
      expect(job?.next).toBeUndefined()
    }))

  test("a schedule Estate cannot read has no next run, and a Job never started is from the start of time", () => {
    expect(nextRun("not a schedule", undefined, new Date(now))).toBeUndefined()
    expect(nextRun("30 6 * * *", "Europe/London", new Date(now))?.toISOString()).toBe("2026-10-04T05:30:00.000Z")
    expect(runOf({ metadata: { name: "j" } })).toEqual({
      name: "j",
      outcome: "running",
      startedAt: "1970-01-01T00:00:00.000Z",
    })
  })

  test("a failed or missed run needs attention, and finished runs are in the feed", () =>
    read.then((result) => {
      const jobs = Result.isSuccess(result) ? result.success : []
      const state = environment({
        cluster: { state: "ok", value: { pods: {}, debug: {}, jobs: { storefront: jobs } } },
      })
      expect(healthOf(storefront, state, [storefront])).toEqual({
        health: "attention",
        reasons: [
          "job storefront-sitemap failed: Job has reached the specified backoff limit",
          "job storefront-sitemap missed a run",
        ],
      })
      const feed = feedView(estate({ environments: { staging: state } }), "staging", now).items.map((item) => item.text)
      expect(feed).toEqual(["job storefront-sitemap failed", "job storefront-sitemap succeeded"])
    }))

  test("need a namespace, and none named are none read", () =>
    Effect.runPromise(jobsOf(cluster, storefront, now).pipe(Effect.provide(stubRemote(() => undefined)))).then(
      (jobs) => {
        expect(jobs).toEqual([])
      },
    ))
})

describe("what the catalog names and the cluster does not have", () => {
  const notFound = reply({ kind: "Status", reason: "NotFound" }, 404)
  const readWith = (answer: (url: string) => ReturnType<typeof reply> | undefined) =>
    Effect.runPromise(
      Effect.result(
        Effect.all([jobsOf(cluster, shop, now), readCluster(cluster, [storefront])]).pipe(
          Effect.provide(stubRemote((call) => answer(call.url))),
        ),
      ),
    )

  test("is said on its own row, and every other part of the read stands", () =>
    readWith((url) =>
      url.endsWith("/jobs") || url.includes("/pods") || url.includes("/deployments") ? reply({ items: [] }) : notFound,
    ).then((result) => {
      const [jobs, workloads] = Result.isSuccess(result) ? result.success : [[], undefined]
      expect(jobs.map((each) => each.absent)).toEqual([
        "the cluster has no CronJob storefront-sitemap in shop",
        "the cluster has no Job storefront-migrate in shop",
      ])
      expect(workloads?.debug).toEqual({})
    }))

  test("is not mistaken for a cluster that fails to answer", () =>
    readWith(() => reply("etcd is unavailable", 500)).then((result) =>
      expect(Result.isFailure(result) && result.failure.message).toStartWith("the cluster answered 500"),
    ))
})

describe("a job no service owns, in Kubernetes", () => {
  test("is read as a service's CronJob or Job in its namespace", () =>
    Effect.runPromise(
      Effect.result(
        kubernetesJobs(
          cluster,
          [
            {
              name: "sitemap",
              environments: [],
              run: { kubernetes: { namespace: "shop", cronJob: "storefront-sitemap" } },
            },
            {
              name: "migrate",
              environments: [],
              run: { kubernetes: { namespace: "shop", job: "storefront-migrate" } },
            },
            { name: "export", environments: [], run: { ecs: { cluster: "shop", scheduledTask: "export" } } },
          ],
          now,
        ).pipe(
          Effect.provide(
            stubRemote((call) => (answers[call.url] === undefined ? undefined : reply(answers[call.url]))),
          ),
        ),
      ),
    ).then((result) => {
      const jobs = Result.isSuccess(result) ? result.success : {}
      expect(Object.keys(jobs)).toEqual(["sitemap", "migrate"])
      expect(jobs["sitemap"]?.[0]).toMatchObject({
        name: "storefront-sitemap",
        kind: "CronJob",
        missed: expect.any(String),
      })
      expect(jobs["migrate"]?.[0]).toMatchObject({ name: "storefront-migrate", kind: "Job" })
    }))
})
