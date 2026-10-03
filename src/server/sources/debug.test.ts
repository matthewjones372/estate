import { describe, expect, test } from "bun:test"
import { Effect, Layer, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { ask, catalog, environment, estate, serverFor, settings, storefront } from "../fixture"
import { type Call, type Reply, reply, stubRemote } from "../remote"
import { Estate, estateLayer } from "../state"
import { revertExpired, switchOff, switchOn } from "./debug"

const cluster = { url: "https://cluster", headers: { authorization: "Bearer t" } }
const configMap = "https://cluster/api/v1/namespaces/shop/configmaps/storefront-logging"

const kube =
  (calls: Call[], status = 200) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    return call.url === configMap && call.method === "PATCH"
      ? reply(status === 200 ? {} : "forbidden", status)
      : undefined
  }

const now = Date.parse("2026-10-03T12:00:00Z")

describe("debug through a ConfigMap", () => {
  test("on writes the debug level, with until, since and by beside it", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      switchOn(cluster, storefront, 15, "ada", now).pipe(Effect.provide(stubRemote(kube(calls)))),
    ).then((debug) => {
      expect(debug).toEqual({
        level: "DEBUG",
        on: true,
        until: "2026-10-03T12:15:00.000Z",
        since: "2026-10-03T12:00:00.000Z",
        by: "ada",
      })
      expect(calls[0]?.headers).toEqual({ authorization: "Bearer t", "content-type": "application/merge-patch+json" })
      expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
        metadata: {
          annotations: {
            "estate.dev/debug-until": "2026-10-03T12:15:00.000Z",
            "estate.dev/debug-since": "2026-10-03T12:00:00.000Z",
            "estate.dev/debug-by": "ada",
          },
        },
        data: { level: "DEBUG" },
      })
    })
  })

  test("off puts the usual level back and takes the annotations away, as the person when Estate impersonates", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      switchOff(cluster, storefront, { name: "ada", groups: ["ops", "admins"] }).pipe(
        Effect.provide(stubRemote(kube(calls))),
      ),
    ).then((debug) => {
      expect(debug).toEqual({ level: "INFO", on: false })
      expect(calls[0]?.headers).toMatchObject({ "impersonate-user": "ada", "impersonate-group": "ops,admins" })
      expect(JSON.parse(calls[0]?.body ?? "{}").metadata.annotations).toEqual({
        "estate.dev/debug-until": null,
        "estate.dev/debug-since": null,
        "estate.dev/debug-by": null,
      })
    })
  })

  test("a cluster that refuses says so in its words, and a service without a level cannot be switched", () =>
    Promise.all([
      Effect.runPromise(
        Effect.result(switchOn(cluster, storefront, 15, "ada", now).pipe(Effect.provide(stubRemote(kube([], 403))))),
      ),
      Effect.runPromise(
        Effect.result(
          switchOff(cluster, { name: "search", environments: [] }).pipe(Effect.provide(stubRemote(kube([])))),
        ),
      ),
    ]).then(([refused, levelless]) => {
      expect(refused._tag === "Failure" && refused.failure.message).toBe("the cluster answered 403: forbidden")
      expect(levelless._tag === "Failure" && levelless.failure.message).toBe(
        "the catalog names no log level for search",
      )
    }))

  test("is put back by itself when its time has passed", () => {
    const calls: Call[] = []
    const on = { level: "DEBUG", on: true, until: "1970-01-01T00:01:30.000Z", by: "ada" }
    const state = estate({
      environments: {
        staging: environment({ cluster: { state: "ok", value: { pods: {}, debug: { storefront: on } } } }),
        production: environment(),
      },
    })
    const program = Effect.gen(function* () {
      yield* Effect.forkChild(revertExpired("staging", Effect.succeed(cluster)))
      yield* TestClock.adjust("61 seconds")
      const early = calls.length
      yield* TestClock.adjust("60 seconds")
      const { staging } = (yield* SubscriptionRef.get(yield* Estate)).environments
      return { early, debug: staging?.cluster.value?.debug }
    })
    return Effect.runPromise(
      program.pipe(Effect.provide(Layer.mergeAll(estateLayer(state), TestClock.layer(), stubRemote(kube(calls))))),
    ).then(({ early, debug }) => {
      expect(early).toBe(0)
      expect(debug).toEqual({ storefront: { level: "INFO", on: false } })
      expect(calls).toHaveLength(1)
    })
  })
})

describe("putting debug back", () => {
  test("waits for a cluster that refuses, and leaves alone what has time left or no cluster read", () => {
    const calls: Call[] = []
    const state = estate({
      environments: {
        staging: environment({
          cluster: {
            state: "ok",
            value: { pods: {}, debug: { storefront: { level: "DEBUG", on: true, until: "1970-01-01T00:00:30.000Z" } } },
          },
        }),
        production: environment(),
      },
    })
    const program = Effect.gen(function* () {
      yield* Effect.forkChild(revertExpired("staging", Effect.succeed(cluster)))
      yield* Effect.forkChild(revertExpired("production", Effect.fail({ message: "unreachable" })))
      yield* TestClock.adjust("61 seconds")
      const { staging } = (yield* SubscriptionRef.get(yield* Estate)).environments
      return staging?.cluster.value?.debug
    })
    return Effect.runPromise(
      program.pipe(Effect.provide(Layer.mergeAll(estateLayer(state), TestClock.layer(), stubRemote(kube(calls, 403))))),
    ).then((debug) => {
      expect(debug).toMatchObject({ storefront: { on: true } })
      expect(calls.length).toBeGreaterThan(0)
    })
  })
})

describe("switching debug from the page", () => {
  const configured = (role: "viewer" | "operator", kubernetes = true) => ({
    ...settings({ anonymous: { name: "ada", role } }),
    sources: { staging: kubernetes ? { kubernetes: { url: "https://cluster", token: "t" } } : {}, production: {} },
  })
  const withCluster = estate({
    environments: {
      staging: environment({ cluster: { state: "ok", value: { pods: {}, debug: {} } } }),
      production: environment(),
    },
  })
  const on = (body: unknown) =>
    new Request("http://estate/api/debug", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  test("turns it on and off, and the page shows it at once", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured("operator"), withCluster, kube(calls))
        const answered = yield* ask(server, on({ environment: "staging", service: "storefront", minutes: 60 }))
        expect([answered.status, answered.json()]).toMatchObject([201, { level: "DEBUG", on: true, by: "ada" }])
        const shown = (yield* SubscriptionRef.get(yield* Effect.provide(Estate, server.context))).environments
        expect(shown).toMatchObject({ staging: { cluster: { value: { debug: { storefront: { on: true } } } } } })
        const off = yield* ask(
          server,
          new Request("http://estate/api/debug/storefront?env=staging", { method: "DELETE" }),
        )
        expect([off.status, off.json()]).toEqual([200, { level: "INFO", on: false }])
        expect(calls).toHaveLength(2)
      }),
    )
  })

  test("is switched as the person, named as the cluster names them, when Estate impersonates", () => {
    const calls: Call[] = []
    const impersonating = {
      ...configured("operator"),
      sources: {
        staging: {
          kubernetes: { url: "https://cluster", token: "t", impersonate: true, impersonationPrefix: "pocket-id:" },
        },
        production: {},
      },
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(impersonating, withCluster, kube(calls))
        yield* ask(server, on({ environment: "staging", service: "storefront", minutes: 15 }))
        expect(calls[0]?.headers).toMatchObject({ "impersonate-user": "pocket-id:ada" })
      }),
    )
  })

  test("is for operators, a minute to a day, for a service with a level, where there is a cluster", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const refusal = (server: Effect.Success<ReturnType<typeof serverFor>>, body: unknown) =>
          ask(server, on(body)).pipe(Effect.map((answered) => [answered.status, answered.json()]))
        const viewer = yield* serverFor(configured("viewer"), withCluster, kube([]))
        expect(yield* refusal(viewer, { environment: "staging", service: "storefront", minutes: 5 })).toEqual([
          403,
          { message: "switching debug is for operators" },
        ])
        const server = yield* serverFor(configured("operator"), withCluster, kube([], 403))
        expect(yield* refusal(server, { environment: "staging", service: "storefront", minutes: 5000 })).toEqual([
          400,
          { message: "debug lasts a minute to a day" },
        ])
        expect(yield* refusal(server, { environment: "staging", service: "search", minutes: 5 })).toEqual([
          404,
          { message: "the catalog names no log level for search" },
        ])
        expect(yield* refusal(server, { environment: "staging", service: "payments", minutes: 5 })).toEqual([
          404,
          { message: "payments is not in staging" },
        ])
        expect(yield* refusal(server, { service: "storefront" })).toEqual([
          400,
          { message: "debug is an environment, a service and minutes" },
        ])
        expect(yield* refusal(server, { environment: "staging", service: "storefront", minutes: 5 })).toEqual([
          502,
          { message: "the cluster answered 403: forbidden" },
        ])
        const off = yield* ask(
          server,
          new Request("http://estate/api/debug/storefront?env=staging", { method: "DELETE" }),
        )
        expect(off.status).toBe(502)
        const nowhere = yield* serverFor(configured("operator", false), withCluster, kube([]))
        expect(yield* refusal(nowhere, { environment: "staging", service: "storefront", minutes: 5 })).toEqual([
          404,
          { message: "staging has no cluster to switch it in" },
        ])
        const inside = yield* serverFor(
          { ...configured("operator"), sources: { staging: { kubernetes: {} }, production: {} } },
          withCluster,
          kube([]),
        )
        expect(yield* refusal(inside, { environment: "staging", service: "storefront", minutes: 5 })).toEqual([
          502,
          { message: "Estate is not in a cluster, and no url is set" },
        ])
        expect(catalog.services).toHaveLength(4)
      }),
    ))
})
