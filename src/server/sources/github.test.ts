import { describe, expect, test } from "bun:test"
import { Effect, Layer, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { catalog, estate } from "../fixture"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import { Estate, estateLayer } from "../state"
import { runBuilds, statusOf } from "./github"

const runs = {
  total_count: 2,
  workflow_runs: [
    {
      head_sha: "3889c5c0",
      display_title: "New basket",
      status: "in_progress",
      conclusion: null,
      updated_at: "2026-10-03T11:56:00Z",
      html_url: "https://github.com/example/orders/actions/runs/2",
    },
    {
      head_sha: "c556728a",
      display_title: "Faster pages",
      status: "completed",
      conclusion: "success",
      updated_at: "2026-10-03T11:00:00Z",
      html_url: "https://github.com/example/orders/actions/runs/1",
    },
  ],
}

const withBuilds = {
  ...catalog,
  services: [
    {
      name: "orders",
      environments: ["staging"],
      repository: "github:example/orders",
      build: { workflow: "build.yml" },
    },
    ...catalog.services.slice(2),
  ],
}

/** GitHub as a stub: the runs with an ETag, then 304 when asked with it. */
const github =
  (calls: Call[], answer?: (call: Call) => Reply) =>
  (call: Call): Reply => {
    calls.push(call)
    if (answer !== undefined) return answer(call)
    return call.headers?.["if-none-match"] === '"one"'
      ? { status: 304, headers: {}, text: "" }
      : reply(runs, 200, { etag: '"one"' })
  }

const read = (answer: (call: Call) => Reply, minutes = 0) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ref = yield* Estate
      yield* Effect.forkChild(runBuilds({ token: "secret" }))
      yield* TestClock.adjust(`${minutes * 60 + 1} seconds`)
      return (yield* SubscriptionRef.get(ref)).builds
    }).pipe(
      Effect.provide(
        Layer.mergeAll(estateLayer(estate({ catalog: withBuilds })), TestClock.layer(), stubRemote(answer)),
      ),
    ),
  )

describe("builds from GitHub", () => {
  test("are each service's workflow runs on its branch, newest first", () => {
    const calls: Call[] = []
    return read(github(calls)).then((builds) => {
      expect(builds.state).toBe("ok")
      expect(builds.value).toEqual({
        orders: [
          {
            sha: "3889c5c0",
            title: "New basket",
            status: "running",
            at: "2026-10-03T11:56:00Z",
            url: "https://github.com/example/orders/actions/runs/2",
          },
          {
            sha: "c556728a",
            title: "Faster pages",
            status: "success",
            at: "2026-10-03T11:00:00Z",
            url: "https://github.com/example/orders/actions/runs/1",
          },
        ],
        payments: [],
        search: [],
      })
      expect(calls[0]?.url).toBe(
        "https://api.github.com/repos/example/orders/actions/workflows/build.yml/runs?branch=main&per_page=8",
      )
      expect(calls[0]?.headers).toMatchObject({ authorization: "Bearer secret" })
    })
  })

  test("are asked for again with the last ETag, and kept when nothing changed", () => {
    const calls: Call[] = []
    return read(github(calls), 1).then((builds) => {
      expect(calls.map((call) => call.headers?.["if-none-match"])).toEqual([undefined, '"one"'])
      expect(builds.value).toMatchObject({ orders: [{ status: "running" }, { status: "success" }] })
    })
  })

  test("that GitHub refuses are failing, with its words", () =>
    read(github([], () => reply({ message: "Bad credentials" }, 401))).then((builds) => {
      expect(builds).toEqual({
        state: "failing",
        message: 'GitHub answered 401 for example/orders: {"message":"Bad credentials"}',
      })
    }))

  test("read in a strange shape say so", () =>
    read(github([], () => reply({ runs: [] }))).then((builds) => {
      expect(builds.message).toBe("GitHub answered example/orders's runs in a shape Estate does not know")
    }))

  test("name a run's state the way the page does", () => {
    expect(statusOf({ status: "queued", conclusion: null })).toBe("queued")
    expect(statusOf({ status: "completed", conclusion: "failure" })).toBe("failure")
    expect(statusOf({ status: "completed", conclusion: "timed_out" })).toBe("failure")
    expect(statusOf({ status: "completed", conclusion: "skipped" })).toBe("cancelled")
  })
})
