import { describe, expect, test } from "bun:test"
import { Effect, Redacted, Result } from "effect"
import { type Call, reply, stubRemote } from "../remote"
import { readBuilds } from "./builds"
import { readHarnessDeploys, statusOf } from "./harness"

const harness = { account: "acct", apiKey: Redacted.make("pat.key") }
const shop = { org: "default", project: "shop" }
const payments = {
  name: "payments",
  environments: [],
  build: { harness: { ...shop, pipeline: "payments_ci" } },
  deploy: { harness: { ...shop, pipeline: "payments_cd" } },
}

const commit = (id: string, message: string) => ({
  ci: { ciExecutionInfoDTO: { branch: { commits: [{ id, message }] } } },
})
const deployed = (environment: string, tag: string) => ({
  cd: { envIdentifiers: [environment], serviceInfoList: [{ identifier: "payments", artifacts: { primary: { tag } } }] },
})

const ci = [
  {
    planExecutionId: "e3",
    runSequence: 3,
    status: "AsyncWaiting",
    startTs: 1_791_028_000_000,
    moduleInfo: commit("c3", "Charge in pence"),
  },
  {
    planExecutionId: "e2",
    runSequence: 2,
    status: "Failed",
    startTs: 1_791_027_000_000,
    endTs: 1_791_027_090_000,
    moduleInfo: commit("b2", "Retry the card provider\n\nWith backoff."),
  },
  { planExecutionId: "e1", runSequence: 1, status: "Success", startTs: 1_791_026_000_000, endTs: 1_791_026_060_000 },
]

const cd = [
  {
    planExecutionId: "d4",
    status: "Failed",
    startTs: 1_791_028_000_000,
    endTs: 1_791_028_120_000,
    failureInfo: { message: "Deployment exceeded progress deadline" },
    moduleInfo: deployed("production", "v2.1.0"),
  },
  { planExecutionId: "d3", status: "Success", endTs: 1_791_027_000_000, moduleInfo: deployed("staging", "v2.1.0") },
  { planExecutionId: "d2", status: "Success", endTs: 1_791_026_000_000, moduleInfo: deployed("production", "v2.0.3") },
]

const answer = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.headers?.["x-api-key"] !== "pat.key") return reply({ message: "Invalid API key" }, 401)
  const pipeline = new URL(call.url).searchParams.get("pipelineIdentifier")
  if (pipeline === "payments_ci") return reply({ status: "SUCCESS", data: { content: ci } })
  if (pipeline === "payments_cd") return reply({ status: "SUCCESS", data: { content: cd } })
  return undefined
}

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(Effect.result(effect))

describe("Harness", () => {
  test("gives a CI pipeline's executions as builds, each with its commit and its page", () => {
    const calls: Call[] = []
    return run(readBuilds({ harness }, [payments]).pipe(Effect.provide(stubRemote(answer(calls))))).then((read) => {
      const builds = Result.isSuccess(read) ? (read.success[0]?.[1] ?? []) : []
      expect(builds.map((build) => [build.sha, build.title, build.status])).toEqual([
        ["c3", "Charge in pence", "running"],
        ["b2", "Retry the card provider", "failure"],
        ["", "#1", "success"],
      ])
      expect(builds[1]?.url).toBe(
        "https://app.harness.io/ng/account/acct/module/ci/orgs/default/projects/shop/pipelines/payments_ci/executions/e2/pipeline",
      )
      const url = new URL(calls[0]?.url ?? "")
      expect([url.pathname, url.searchParams.get("accountIdentifier"), calls[0]?.method]).toEqual([
        "/pipeline/api/pipelines/execution/summary",
        "acct",
        "POST",
      ])
    })
  })

  test("gives what CD last deployed to each environment, and a failed deployment as the last good version, stalled", () =>
    Promise.all([
      run(readHarnessDeploys(harness, [payments], "production").pipe(Effect.provide(stubRemote(answer([]))))),
      run(readHarnessDeploys(harness, [payments], "staging").pipe(Effect.provide(stubRemote(answer([]))))),
      run(readHarnessDeploys(harness, [payments], "qa").pipe(Effect.provide(stubRemote(answer([]))))),
    ]).then(([production, staging, qa]) => {
      expect(Result.isSuccess(production) && production.success).toEqual({
        payments: {
          version: "v2.0.3",
          ready: false,
          at: "2026-10-03T11:48:40.000Z",
          stalled: "Deployment exceeded progress deadline",
        },
      })
      expect(Result.isSuccess(staging) && staging.success).toEqual({
        payments: { version: "v2.1.0", ready: true, at: "2026-10-03T11:30:00.000Z" },
      })
      expect(Result.isSuccess(qa) && qa.success).toEqual({})
    }))

  test("names the pipeline when it refuses or answers strangely, and reads its kinds of status", () => {
    const strange = { ...payments, build: { harness: { ...shop, pipeline: "unknown_ci" } } }
    return Promise.all([
      run(
        readBuilds({ harness: { ...harness, apiKey: Redacted.make("wrong") } }, [payments]).pipe(
          Effect.provide(stubRemote(answer([]))),
        ),
      ),
      run(
        readBuilds({ harness: { ...harness, url: "https://harness.example/" } }, [strange]).pipe(
          Effect.provide(stubRemote(() => reply({ data: 1 }))),
        ),
      ),
    ]).then(([refused, odd]) => {
      expect(Result.isFailure(refused) && refused.failure.message).toBe(
        'Harness answered 401 for payments_ci: {"message":"Invalid API key"}',
      )
      expect(Result.isFailure(odd) && odd.failure.message).toBe(
        "Harness answered unknown_ci's executions in a shape Estate does not know",
      )
      expect(
        ["Success", "IgnoreFailed", "Expired", "AbortedByFreeze", "NotStarted", "InterventionWaiting"].map(statusOf),
      ).toEqual(["success", "success", "failure", "cancelled", "queued", "running"])
    })
  })
})
