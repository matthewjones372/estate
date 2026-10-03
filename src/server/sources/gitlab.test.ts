import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import type { Catalog } from "../../shared/catalog"
import { catalog, estate } from "../fixture"
import { type Call, Remote, RemoteError, type Reply, reply, stubRemote } from "../remote"
import type { Settings } from "../settings"
import { Estate, estateLayer } from "../state"
import { runBuilds } from "./builds"
import { statusOf } from "./gitlab"

type Tools = NonNullable<Settings["builds"]>

const project = "https://gitlab.example/api/v4/projects/shop%2Forders"

const withPipelines: Catalog = {
  ...catalog,
  services: [
    { name: "orders", environments: ["staging"], build: { gitlab: { project: "shop/orders" } } },
    { name: "search", environments: ["staging"], build: { gitlab: { project: "shop/search", ref: "release" } } },
    { name: "storefront", environments: ["staging"], build: { workflow: "build.yml" } },
  ],
}

const pipeline = (id: number, sha: string, status: string) => ({
  id,
  sha,
  status,
  updated_at: "2026-10-03T11:56:00Z",
  web_url: `https://gitlab.example/shop/orders/-/pipelines/${id}`,
})

/** GitLab as a stub: orders' latest pipeline per `latest`, its commits and failed jobs, and an ETag. */
const gitlab =
  (calls: Call[], latest = "running", searchOdd = false) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    if (call.headers?.["private-token"] !== "glpat") return reply("unauthorised", 401)
    if (call.url === `${project}/pipelines?ref=main&per_page=8`)
      return call.headers?.["if-none-match"] === '"p1"'
        ? { status: 304, headers: {}, text: "" }
        : reply([pipeline(42, "3889c5c0", latest), pipeline(41, "1a2b3c4d", "success")], 200, { etag: '"p1"' })
    if (call.url === `${project}/repository/commits?ref_name=main&per_page=20`)
      return reply([{ id: "3889c5c0", title: "New basket" }])
    if (call.url === `${project}/pipelines/42/jobs?scope[]=failed`) return reply([{ name: "test" }])
    if (call.url.includes("shop%2Fsearch/pipelines")) return reply(searchOdd ? { message: "odd" } : [])
    return undefined
  }

const read = (
  answer: (call: Call) => Reply | undefined,
  minutes = 0,
  tools: Tools = { gitlab: { url: "https://gitlab.example/", token: Redacted.make("glpat") } },
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* Effect.forkChild(runBuilds(tools))
      yield* TestClock.adjust(`${minutes * 60 + 1} seconds`)
      return (yield* SubscriptionRef.get(yield* Estate)).builds
    }).pipe(
      Effect.provide(
        Layer.mergeAll(estateLayer(estate({ catalog: withPipelines })), TestClock.layer(), stubRemote(answer)),
      ),
    ),
  )

describe("builds from GitLab", () => {
  test("are a service's pipelines on its ref, titled by their commits, a running one building", () => {
    const calls: Call[] = []
    return read(gitlab(calls)).then((builds) => {
      expect(builds.state).toBe("ok")
      expect(builds.value?.["orders"]).toEqual([
        {
          sha: "3889c5c0",
          title: "New basket",
          status: "running",
          at: "2026-10-03T11:56:00Z",
          url: "https://gitlab.example/shop/orders/-/pipelines/42",
        },
        {
          sha: "1a2b3c4d",
          title: "pipeline 41",
          status: "success",
          at: "2026-10-03T11:56:00Z",
          url: "https://gitlab.example/shop/orders/-/pipelines/41",
        },
      ])
      expect(builds.value?.["storefront"]).toEqual([])
      expect(calls.some((call) => call.url.includes("shop%2Fsearch/pipelines?ref=release"))).toBe(true)
    })
  })

  test("name the job that failed in the latest pipeline", () =>
    read(gitlab([], "failed")).then((builds) => {
      expect(builds.value?.["orders"]?.[0]).toMatchObject({ status: "failure", job: "test" })
      expect(builds.value?.["orders"]?.[1]?.job).toBeUndefined()
    }))

  test("cost a 304 when nothing changed, and keep what was read", () => {
    const calls: Call[] = []
    return read(gitlab(calls), 1).then((builds) => {
      const asked = calls.filter((call) => call.url.endsWith("/pipelines?ref=main&per_page=8"))
      expect(asked.at(-1)?.headers?.["if-none-match"]).toBe('"p1"')
      expect(builds.value?.["orders"]?.[0]?.title).toBe("New basket")
    })
  })

  test("say what GitLab said when it refuses, or answers in another shape", () =>
    Promise.all([
      read(gitlab([]), 0, { gitlab: { url: "https://gitlab.example" } }),
      read(gitlab([], "running", true)),
    ]).then(([refused, odd]) => {
      expect(refused.message).toBe("GitLab answered 401 for shop/orders: unauthorised")
      expect(odd.message).toBe("GitLab answered shop/search's pipelines in a shape Estate does not know")
    }))

  test("are not read for a service whose tool is not set up", () =>
    read(() => undefined, 0, {}).then((builds) => {
      expect(builds.value).toEqual({ orders: [], search: [], storefront: [] })
    }))

  test("map GitLab's statuses to Estate's", () => {
    expect(
      ["success", "failed", "running", "canceled", "skipped", "pending", "manual", "created"].map(statusOf),
    ).toEqual(["success", "failure", "running", "cancelled", "cancelled", "queued", "queued", "queued"])
  })

  test("keep their pipelines when the commits or failed jobs do not answer, and say when GitLab cannot be reached", () => {
    const withoutExtras = (call: Call) =>
      call.url.includes("/repository/commits") || call.url.includes("/jobs")
        ? reply("down", 500)
        : gitlab([], "failed")(call)
    const unreachable = Layer.succeed(Remote)({
      call: (call) => Effect.fail(new RemoteError({ url: call.url, message: "could not reach gitlab.example" })),
    })
    return Promise.all([
      read(withoutExtras),
      Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.forkChild(runBuilds({ gitlab: { url: "https://gitlab.example" } }))
          yield* TestClock.adjust("1 second")
          return (yield* SubscriptionRef.get(yield* Estate)).builds
        }).pipe(
          Effect.provide(
            Layer.mergeAll(estateLayer(estate({ catalog: withPipelines })), TestClock.layer(), unreachable),
          ),
        ),
      ),
    ]).then(([quiet, gone]) => {
      expect(quiet.value?.["orders"]?.[0]).toMatchObject({ title: "pipeline 42", status: "failure" })
      expect(quiet.value?.["orders"]?.[0]?.job).toBeUndefined()
      expect(gone.message).toBe("GitLab could not reach gitlab.example")
    })
  })
})
