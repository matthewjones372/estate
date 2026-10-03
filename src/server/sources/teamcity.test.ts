import { describe, expect, test } from "bun:test"
import { Effect, Redacted, Result } from "effect"
import { type Call, reply, stubRemote } from "../remote"
import { readBuilds } from "./builds"
import { instantOf } from "./teamcity"

const teamcity = { url: "https://teamcity.example/", token: Redacted.make("tc-token") }
const checkout = {
  name: "checkout",
  environments: [],
  build: { teamcity: { buildType: "Shop_Checkout", branch: "main" } },
}

/** TeamCity's JSON for a build type's builds: one running, one failed on a change it names, one passed. */
const builds = {
  build: [
    {
      number: "120",
      state: "running",
      status: "SUCCESS",
      webUrl: "https://tc/120",
      startDate: "20261003T114500+0000",
      revisions: { revision: [{ version: "c3" }] },
    },
    {
      number: "119",
      state: "finished",
      status: "FAILURE",
      webUrl: "https://tc/119",
      startDate: "20261003T113000+0000",
      finishDate: "20261003T113400+0100",
      revisions: { revision: [{ version: "b2" }] },
      changes: { change: [{ version: "b2", comment: "Retry the card provider\nwith backoff" }] },
    },
    {
      number: "118",
      state: "finished",
      status: "SUCCESS",
      webUrl: "https://tc/118",
      finishDate: "20261003T100000+0000",
    },
    { state: "queued", webUrl: "https://tc/queued", queuedDate: "20261003T114600+0000" },
  ],
}

const answer = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.headers?.["authorization"] !== "Bearer tc-token") return reply("no", 401)
  const url = new URL(call.url)
  const asked = url.pathname === "/app/rest/builds" && url.searchParams.get("locator")?.includes("id:Shop_Checkout")
  return asked ? reply(builds) : undefined
}

describe("TeamCity", () => {
  test("gives a build type's builds on a branch: running, failed with its change, passed and queued", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.result(readBuilds({ teamcity }, [checkout]).pipe(Effect.provide(stubRemote(answer(calls))))),
    ).then((read) => {
      expect(Result.isSuccess(read) && read.success[0]?.[1]).toEqual([
        { sha: "c3", title: "#120", status: "running", at: "2026-10-03T11:45:00.000Z", url: "https://tc/120" },
        {
          sha: "b2",
          title: "Retry the card provider",
          status: "failure",
          at: "2026-10-03T10:34:00.000Z",
          url: "https://tc/119",
        },
        { sha: "", title: "#118", status: "success", at: "2026-10-03T10:00:00.000Z", url: "https://tc/118" },
        { sha: "", title: "#?", status: "queued", at: "2026-10-03T11:46:00.000Z", url: "https://tc/queued" },
      ])
      expect(new URL(calls[0]?.url ?? "").searchParams.get("locator")).toBe(
        "buildType:(id:Shop_Checkout),branch:(name:main),state:any,canceled:any,count:10",
      )
      expect(calls[0]?.headers?.["accept"]).toBe("application/json")
    })
  })

  test("names the build type when it refuses or answers strangely, and reads a cancelled build as cancelled", () => {
    const strange = { name: "search", environments: [], build: { teamcity: { buildType: "Shop_Search" } } }
    return Promise.all([
      Effect.runPromise(
        Effect.result(readBuilds({ teamcity }, [strange]).pipe(Effect.provide(stubRemote(answer([]))))),
      ),
      Effect.runPromise(
        Effect.result(readBuilds({ teamcity }, [strange]).pipe(Effect.provide(stubRemote(() => reply({ build: 1 }))))),
      ),
      Effect.runPromise(
        Effect.result(
          readBuilds({ teamcity: { url: "https://tc" } }, [strange]).pipe(
            Effect.provide(
              stubRemote(() => reply({ build: [{ state: "finished", status: "UNKNOWN", webUrl: "https://tc/1" }] })),
            ),
          ),
        ),
      ),
    ]).then(([missing, odd, cancelled]) => {
      expect(Result.isFailure(missing) && missing.failure.message).toBe(
        "TeamCity answered 404 for Shop_Search: not found",
      )
      expect(Result.isFailure(odd) && odd.failure.message).toBe(
        "TeamCity answered Shop_Search's builds in a shape Estate does not know",
      )
      expect(Result.isSuccess(cancelled) && cancelled.success[0]?.[1][0]?.status).toBe("cancelled")
      expect(instantOf("yesterday")).toBe("1970-01-01T00:00:00.000Z")
    })
  })
})
