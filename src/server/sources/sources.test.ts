import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { catalog, environment, estate, settings, storefront } from "../fixture"
import { type Call, type Remote, stubRemote } from "../remote"
import { Estate, estateLayer, type SourcedAlert } from "../state"
import { alertId, readAlerts, withResolved } from "./alerts"
import { answering } from "./answers"
import { debugOf, readCluster } from "./cluster"
import { readDeploys, revisionOf, tagOf } from "./flux"
import { clusterOf } from "./kubernetes"
import { afterRead, runSource } from "./run"
import { startSources } from "./start"

const run = <A, E>(effect: Effect.Effect<A, E, Remote>, calls: Call[] = []) =>
  Effect.runPromise(Effect.result(effect.pipe(Effect.provide(stubRemote(answering(undefined, calls))))))

const cluster = { url: "https://cluster", headers: { authorization: "Bearer t" } }
const shop = {
  ...storefront,
  kubernetes: { namespace: "shop", workloads: [{ kind: "Deployment" as const, name: "storefront" }] },
  deploy: { flux: { kustomization: "shop", imagePolicy: "storefront" } },
}

describe("alerts", () => {
  test("come from Alertmanager with their silences, and pending ones from Prometheus", () =>
    run(readAlerts({ alertmanager: { url: "http://alertmanager/" }, prometheus: { url: "http://prometheus" } })).then(
      (read) => {
        const alerts = Result.isSuccess(read) ? read.success : []
        expect(alerts.map((alert) => `${alert.name}:${alert.state}:${alert.severity}`)).toEqual([
          "OrdersSlow:firing:warning",
          "DiskFilling:silenced:warning",
          "QueueGrowing:pending:critical",
        ])
        expect(alerts[0]).toMatchObject({ summary: "Orders are slow", runbook: "https://runbooks.example/orders-slow" })
        expect(alerts[1]).toMatchObject({
          summary: "The disk fills",
          silence: { id: "s1", by: "ada", reason: "resizing" },
        })
      },
    ))

  test("come all from Prometheus when there is no Alertmanager", () =>
    run(readAlerts({ prometheus: { url: "http://prometheus" } })).then((read) => {
      expect(Result.isSuccess(read) && read.success.map((alert) => alert.state)).toEqual(["pending", "firing"])
    }))

  test("are known by their labels, in any order, whichever tool sent them", () => {
    expect(alertId({ a: "1", b: "2" })).toBe(alertId({ b: "2", a: "1" }))
    expect(alertId({ a: "1", alertstate: "firing" })).toBe(alertId({ a: "1", alertstate: "pending" }))
    expect(alertId({ a: "1" })).not.toBe(alertId({ a: "2" }))
  })

  test("that do not answer, or answer strangely, say so", () =>
    Promise.all([
      run(readAlerts({ alertmanager: { url: "http://nowhere" } })),
      Effect.runPromise(
        Effect.result(
          readAlerts({ prometheus: { url: "http://odd" } }).pipe(
            Effect.provide(stubRemote(answering({ "http://odd/api/v1/alerts": { data: 1 } }))),
          ),
        ),
      ),
    ]).then(([missing, odd]) => {
      expect(Result.isFailure(missing) && missing.failure.message).toBe("Alertmanager answered 404: not found")
      expect(Result.isFailure(odd) && odd.failure.message).toBe("Prometheus answered in a shape Estate does not know")
    }))

  test("that stop firing are resolved, and kept for a day", () => {
    const alert = (name: string, state: SourcedAlert["state"] = "firing"): SourcedAlert => ({
      id: name,
      name,
      state,
      severity: "warning",
      startsAt: "2026-10-03T10:00:00Z",
      labels: {},
    })
    const before = environment({
      alerts: { state: "ok", value: [alert("Gone"), alert("Stays"), alert("Waited", "pending")] },
      resolved: [{ name: "Old", labels: {}, startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-02T00:00:00Z" }],
    })
    const after = withResolved(before, before, [alert("Stays")], "2026-10-03T12:00:00Z")
    expect(after.resolved).toEqual([
      { name: "Gone", labels: {}, startsAt: "2026-10-03T10:00:00Z", endsAt: "2026-10-03T12:00:00Z" },
    ])
  })
})

describe("the cluster", () => {
  test("gives each workload's pods by its selector, and the debug level from its ConfigMap", () =>
    run(readCluster(cluster, [shop, { name: "search", environments: [] }])).then((read) => {
      const workloads = Result.isSuccess(read) ? read.success : { pods: {}, debug: {} }
      expect(workloads.pods).toEqual({
        storefront: [
          {
            name: "storefront-1",
            phase: "Running",
            ready: true,
            restarts: 0,
            image: "registry.example/storefront:v2",
            node: "one",
            startedAt: "2026-10-03T10:00:00Z",
          },
          {
            name: "storefront-2",
            phase: "Running",
            ready: false,
            restarts: 3,
            image: "registry.example/storefront:v2",
            node: "one",
            startedAt: "2026-10-03T10:00:00Z",
          },
        ],
        search: [],
      })
      expect(workloads.debug).toEqual({
        storefront: {
          level: "DEBUG",
          on: true,
          until: "2026-10-03T12:05:00Z",
          since: "2026-10-03T11:50:00Z",
          by: "ada",
        },
      })
    }))

  test("debug is off at the usual level, whatever the annotations say", () => {
    expect(debugOf(["INFO", "DEBUG"], { level: "INFO" }, "level", {})).toEqual({ level: "INFO", on: false })
    expect(debugOf(["INFO", "DEBUG"], {}, "level", {})).toEqual({ level: "INFO", on: false })
  })

  test("is found from inside it, or from the settings", () =>
    Promise.all([
      Effect.runPromise(Effect.result(clusterOf({}, {}))),
      Effect.runPromise(Effect.result(clusterOf({ url: "https://cluster/", token: Redacted.make("t") }, {}))),
      Effect.runPromise(Effect.result(clusterOf({ inCluster: true }, { KUBERNETES_SERVICE_HOST: "10.0.0.1" }))),
      Effect.runPromise(Effect.result(clusterOf({ url: "https://cluster", caFile: "/nowhere/ca.crt" }, {}))),
    ]).then(([nowhere, named, inside, noCa]) => {
      expect(Result.isFailure(nowhere) && nowhere.failure.message).toBe("Estate is not in a cluster, and no url is set")
      expect(Result.isSuccess(named) && named.success).toEqual({
        url: "https://cluster",
        headers: { authorization: "Bearer t" },
      })
      expect(Result.isFailure(inside) && inside.failure.message).toBe(
        "cannot read /var/run/secrets/kubernetes.io/serviceaccount/token",
      )
      expect(Result.isFailure(noCa) && noCa.failure.message).toBe("cannot read /nowhere/ca.crt")
    }))

  test("a strange answer names the path", () =>
    Effect.runPromise(
      Effect.result(
        readCluster(cluster, [shop]).pipe(
          Effect.provide(
            stubRemote(
              answering({ "https://cluster/apis/apps/v1/namespaces/shop/deployments/storefront": { spec: 1 } }),
            ),
          ),
        ),
      ),
    ).then((read) => {
      expect(Result.isFailure(read) && read.failure.message).toBe(
        "the cluster answered /apis/apps/v1/namespaces/shop/deployments/storefront in a shape Estate does not know",
      )
    }))
})

describe("Flux", () => {
  test("chose a version, and says why it stalled in its own words", () => {
    const calls: Call[] = []
    return run(readDeploys(cluster, [shop, { name: "search", environments: [] }]), calls).then((read) => {
      expect(Result.isSuccess(read) && read.success).toEqual({
        storefront: {
          version: "v3",
          ready: true,
          at: "2026-10-03T11:20:00Z",
          stalled: "cannot list tags: 401 Unauthorized",
        },
      })
      expect(calls.map((call) => call.url).filter((url) => url.includes("imagepolicies"))).toHaveLength(2)
    })
  })

  test("names a revision shortly, and a tag from a reference or an image", () => {
    expect(revisionOf("main@sha1:0123456789abcdef")).toBe("main@0123456")
    expect(revisionOf("v1.2.3")).toBe("v1.2.3")
    expect(tagOf({ latestImage: "registry:5000/shop:v9" })).toBe("v9")
    expect(tagOf(undefined)).toBeUndefined()
  })
})

describe("reading on a schedule", () => {
  test("a read that fails keeps what was last read, marked failing with why", () => {
    const ok = afterRead({ state: "waiting" }, { value: 1 }, "t1")
    expect(ok).toEqual({ state: "ok", value: 1, answeredAt: "t1" })
    expect(afterRead(ok, { message: "refused" }, "t2")).toEqual({
      state: "failing",
      message: "refused",
      value: 1,
      answeredAt: "t1",
    })
    expect(afterRead({ state: "waiting" }, { message: "refused" }, "t2")).toEqual({
      state: "failing",
      message: "refused",
    })
  })

  test("reads again on its schedule, into its environment's part", () => {
    let reads = 0
    const program = Effect.gen(function* () {
      const ref = yield* Estate
      yield* Effect.forkChild(
        runSource(
          "staging",
          "alerts",
          "20 seconds",
          Effect.sync(() => {
            reads += 1
            return []
          }),
        ),
      )
      yield* TestClock.adjust("41 seconds")
      const { staging } = (yield* SubscriptionRef.get(ref)).environments
      return staging?.alerts
    })
    return Effect.runPromise(program.pipe(Effect.provide(Layer.merge(estateLayer(estate()), TestClock.layer())))).then(
      (part) => {
        expect(reads).toBe(3)
        expect(part).toMatchObject({ state: "ok", value: [] })
      },
    )
  })
})

describe("every source", () => {
  test("starts for each environment that has it, reading the catalog's services", () => {
    const configured = {
      ...settings(),
      sources: {
        staging: {
          alertmanager: { url: "http://alertmanager" },
          kubernetes: { url: "https://cluster", token: Redacted.make("t") },
          flux: {},
        },
        production: {},
      },
    }
    const shopEstate = estate({ catalog: { ...catalog, services: [shop] } })
    const program = Effect.gen(function* () {
      const ref = yield* Estate
      yield* Effect.forkChild(startSources(configured, catalog.environments, {}))
      yield* TestClock.adjust("1 second")
      yield* Effect.promise(() => Bun.sleep(30))
      return (yield* SubscriptionRef.get(ref)).environments
    })
    return Effect.runPromise(
      program.pipe(Effect.provide(Layer.mergeAll(estateLayer(shopEstate), TestClock.layer(), stubRemote(answering())))),
    ).then(({ staging, production }) => {
      expect(staging?.alerts.state).toBe("ok")
      expect(staging?.cluster.value?.pods).toMatchObject({ storefront: [{ ready: true }, { ready: false }] })
      expect(staging?.deploys.value).toMatchObject({ storefront: { version: "v3" } })
      expect(production?.alerts.state).toBe("off")
    })
  })
})
