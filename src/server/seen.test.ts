import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import type { Incident } from "../shared/incidents"
import type { Pod } from "../shared/workloads"
import { environment, estate } from "./fixture"
import { memoryNotes, Notes } from "./notes"
import { stubRemote } from "./remote"
import { changesOf, recordSeen } from "./seen"
import { type EnvironmentState, type EstateState, estateLayer, type SourcedAlert, updateEstate } from "./state"

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "1970-01-02T10:00:00.000Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}
const pod = (name: string, image: string, more: Partial<Pod> = {}): Pod => ({
  name,
  phase: "Running",
  ready: true,
  restarts: 0,
  image,
  ...more,
})
const running = {
  storefront: [pod("storefront-1", "shop/storefront:1.41.2")],
  orders: [pod("orders-1", "shop/orders:2.0.0"), pod("orders-2", "shop/orders:2.0.0")],
  search: [pod("search-1", "shop/search:1.0.0")],
}
const staging = (pods: Readonly<Record<string, ReadonlyArray<Pod>>>, more: Partial<EnvironmentState> = {}) =>
  environment({ alerts: { state: "ok", value: [slow] }, cluster: { state: "ok", value: { pods, debug: {} } }, ...more })

// On the orders firing, with storefront added; search is in no incident.
const incident: Incident = {
  id: "i1",
  title: "Orders slow",
  openedBy: "gil",
  openedAt: "1970-01-02T10:05:00.000Z",
  firings: [
    {
      environment: "staging",
      alert: "a1",
      startsAt: slow.startsAt,
      linkedBy: "gil",
      linkedAt: "1970-01-02T10:05:00.000Z",
    },
  ],
  added: [{ service: "storefront", by: "gil", at: "1970-01-02T10:06:00.000Z" }],
}
const start = estate({ environments: { staging: staging(running), production: environment() }, incidents: [incident] })

const changing = (pods: Readonly<Record<string, ReadonlyArray<Pod>>>) =>
  updateEstate((state) => ({ ...state, environments: { ...state.environments, staging: staging(pods) } }))

describe("what changes around an open incident", () => {
  test("is kept once as its event for each of its services, and not for a service outside it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        // Two environments' watchers, as two runners of a cluster each own one.
        const watching = yield* Effect.forkChild(
          Effect.all([recordSeen("staging"), recordSeen("production")], { concurrency: 2 }),
        )
        yield* TestClock.adjust("1 second")
        const restarted = { restarts: 1, lastTermination: "OOMKilled" }
        yield* changing({ ...running, storefront: [pod("storefront-1", "shop/storefront:1.42.0")] })
        yield* TestClock.adjust("1 second")
        yield* changing({
          ...running,
          storefront: [pod("storefront-1", "shop/storefront:1.42.0")],
          orders: [pod("orders-1", "shop/orders:2.0.0", restarted), pod("orders-2", "shop/orders:2.0.0")],
          search: [pod("search-1", "shop/search:1.0.0", restarted)],
        })
        yield* TestClock.adjust("1 second")
        yield* changing({
          ...running,
          storefront: [pod("storefront-1", "shop/storefront:1.42.0")],
          orders: [],
          search: [],
        })
        yield* TestClock.adjust("1 second")
        yield* Fiber.interrupt(watching)
        return yield* (yield* Notes).incidentEvents("i1")
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            memoryNotes,
            estateLayer(start),
            TestClock.layer(),
            stubRemote(() => undefined),
          ),
        ),
      ),
    ).then((events) => {
      expect(events.map((each) => [each.kind, each.text, each.service, each.by, each.source])).toEqual([
        ["deployed", "storefront 1.41.2 → 1.42.0 in staging", "storefront", "Estate", "seen"],
        ["restarted", "orders-1 restarted (OOMKilled), 1 restart", "orders", "Estate", "seen"],
        ["scaled", "orders 2 → 0 pods in staging", "orders", "Estate", "seen"],
        [
          "health-changed",
          "orders attention → critical in staging: no pod is ready, OrdersSlow is firing",
          "orders",
          "Estate",
          "seen",
        ],
      ])
    }))

  test("says a lower version is rolled back, a choice, a build, debug and a job, each once", () => {
    const at = (more: Partial<EnvironmentState>, builds: EstateState["builds"] = { state: "ok", value: {} }) =>
      estate({ environments: { staging: staging(running, more) }, builds })
    const before = at(
      { deploys: { state: "ok", value: { orders: { version: "2.0.0", ready: true } } } },
      {
        state: "ok",
        value: { orders: [{ sha: "a1", title: "main-211", status: "running", at: "t", url: "https://ci/211" }] },
      },
    )
    const after = at(
      {
        cluster: {
          state: "ok",
          value: {
            pods: { ...running, orders: [pod("orders-1", "shop/orders:1.9.0"), pod("orders-2", "shop/orders:1.9.0")] },
            debug: { orders: { level: "DEBUG", on: true, until: "1970-01-02T15:00:00.000Z", by: "ada" } },
            jobs: {
              orders: [
                {
                  name: "outbox-sweep",
                  kind: "CronJob",
                  suspended: false,
                  runs: [{ name: "outbox-sweep-1", outcome: "failed", startedAt: "t" }],
                },
              ],
            },
          },
        },
        deploys: { state: "ok", value: { orders: { version: "2.1.0", ready: false } } },
      },
      {
        state: "ok",
        value: {
          orders: [{ sha: "a1", title: "main-211", status: "failure", at: "t", url: "https://ci/211", job: "test" }],
        },
      },
    )
    expect(
      changesOf(before, after, "staging", "orders").map((each) => [each.kind, each.text, each.by ?? "Estate"]),
    ).toEqual([
      ["deployed", "orders 2.0.0 → 1.9.0 in staging, rolled back", "Estate"],
      ["chosen", "orders 2.1.0 chosen in staging, not yet ready", "Estate"],
      ["build", "orders main-211 failed at test", "Estate"],
      ["debug", "debug on for orders in staging until 15:00", "ada"],
      ["job", "job outbox-sweep failed in staging", "Estate"],
    ])
    expect(changesOf(after, after, "staging", "orders")).toEqual([])
  })
})
