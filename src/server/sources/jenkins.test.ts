import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result } from "effect"
import { doctor, printed } from "../doctor"
import { settings } from "../fixture"
import { platform } from "../platform"
import { type Call, reply, stubRemote } from "../remote"
import { readBuilds } from "./builds"
import { jobPath } from "./jenkins"

const jenkins = { url: "https://jenkins.example/", user: "estate", token: Redacted.make("t0ken") }

const checkout = { name: "checkout", environments: [], build: { jenkins: { job: "shop/checkout", branch: "main" } } }
const search = { name: "search", environments: [], build: { jenkins: { job: "shop/search" } } }

const revision = (sha: string) => [null, { lastBuiltRevision: { SHA1: sha } }]

/** Jenkins' JSON for a multibranch job's branch: a build running, one failed, one passed. */
const builds = {
  builds: [
    {
      number: 12,
      result: null,
      inProgress: true,
      timestamp: 1_791_028_000_000,
      url: "https://jenkins/12",
      actions: revision("c3"),
    },
    {
      number: 11,
      result: "FAILURE",
      inProgress: false,
      timestamp: 1_791_027_000_000,
      duration: 90_000,
      url: "https://jenkins/11",
      actions: revision("b2"),
      changeSets: [{ items: [{ commitId: "b2", msg: "Retry the card provider\n\nWith backoff." }] }],
    },
    {
      number: 10,
      result: "SUCCESS",
      inProgress: false,
      timestamp: 1_791_026_000_000,
      duration: 60_000,
      url: "https://jenkins/10",
    },
  ],
}

const answer = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.headers?.["authorization"] !== `Basic ${btoa("estate:t0ken")}`) return reply("no", 401)
  return new URL(call.url).pathname === "/job/shop/job/checkout/job/main/api/json" ? reply(builds) : undefined
}

describe("Jenkins", () => {
  test("gives a branch's builds, running, failed and passed, each with the commit it built", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.result(readBuilds({ jenkins }, [checkout]).pipe(Effect.provide(stubRemote(answer(calls))))),
    ).then((read) => {
      expect(Result.isSuccess(read) && read.success).toEqual([
        [
          "checkout",
          [
            { sha: "c3", title: "#12", status: "running", at: "2026-10-03T11:46:40.000Z", url: "https://jenkins/12" },
            {
              sha: "b2",
              title: "Retry the card provider",
              status: "failure",
              at: "2026-10-03T11:31:30.000Z",
              url: "https://jenkins/11",
            },
            { sha: "", title: "#10", status: "success", at: "2026-10-03T11:14:20.000Z", url: "https://jenkins/10" },
          ],
        ],
      ])
      expect(new URL(calls[0]?.url ?? "").searchParams.get("tree")).toStartWith("builds[number,result,inProgress")
    })
  })

  test("names a job by its folders, and its branch's job when it has one", () => {
    expect(jobPath("shop/checkout", "feature/a b")).toBe("/job/shop/job/checkout/job/feature%2Fa%20b")
    expect(jobPath("search")).toBe("/job/search")
  })

  test("that has no such job is named in estate doctor's report", () => {
    const configured = { ...settings(), builds: { jenkins } }
    const catalog = { environments: [], services: [checkout, search] }
    return Effect.runPromise(
      doctor(configured, catalog).pipe(Effect.provide(Layer.merge(stubRemote(answer([])), platform))),
    ).then((reports) => {
      const { text, ok } = printed(reports)
      expect(ok).toBe(false)
      expect(text).toContain("builds   fail  Jenkins answered 404 for shop/search: not found")
    })
  })
})
