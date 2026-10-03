import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import type { Service } from "../../shared/catalog"
import { catalog, estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, reply, stubRemote } from "../remote"
import { Estate, estateLayer } from "../state"
import { chosenOf, readArgo } from "./argo"
import { startSources } from "./start"

const orders: Service = { name: "orders", environments: ["staging"], deploy: { argo: { application: "shop-orders" } } }
const argo = { url: "https://argo.example/", token: Redacted.make("argo-token") }

const synced = {
  sync: { status: "Synced", revision: "3889c5c0aa" },
  health: { status: "Healthy" },
  operationState: { phase: "Succeeded", finishedAt: "2026-10-03T11:40:00Z" },
  summary: { images: ["registry.example/search:v1", "registry.example/orders:v2.4.0"] },
}

describe("what Argo CD chose", () => {
  test("is the service's image tag, ready when in sync and healthy", () => {
    expect(chosenOf(orders, synced)).toEqual({ version: "v2.4.0", ready: true, at: "2026-10-03T11:40:00Z" })
  })

  test("is stalled with Argo's words when out of sync, a sync failed, or it is degraded", () => {
    const { operationState: _, ...unsynced } = synced
    const outOfSync = {
      ...unsynced,
      sync: { status: "OutOfSync" },
      conditions: [{ type: "SyncError", message: "Failed sync attempt: one or more objects failed to apply" }],
      reconciledAt: "2026-10-03T11:50:00Z",
    }
    expect(chosenOf(orders, outOfSync)).toMatchObject({
      ready: false,
      at: "2026-10-03T11:50:00Z",
      stalled: "Failed sync attempt: one or more objects failed to apply",
    })
    const failed = { ...synced, operationState: { phase: "Failed", message: "hook failed" } }
    expect(chosenOf(orders, failed).stalled).toBe("hook failed")
    expect(chosenOf(orders, { ...synced, operationState: { phase: "Error" } }).stalled).toBe("the sync failed")
    const degraded = { ...synced, health: { status: "Degraded", message: "Deployment exceeded its progress deadline" } }
    expect(chosenOf(orders, degraded).stalled).toBe("Deployment exceeded its progress deadline")
    expect(chosenOf(orders, { ...synced, health: { status: "Degraded" } }).stalled).toBe("Argo CD says it is degraded")
    expect(chosenOf(orders, { sync: { status: "OutOfSync" } }).stalled).toBe("out of sync, and no sync is running")
  })

  test("is not stalled while a sync is running", () => {
    const running = { ...synced, sync: { status: "OutOfSync" }, operationState: { phase: "Running" } }
    expect(chosenOf(orders, running)).toMatchObject({ ready: false })
    expect(chosenOf(orders, running).stalled).toBeUndefined()
  })

  test("is the revision when no image is the service's, or unknown without one", () => {
    expect(chosenOf(orders, { sync: { status: "Synced", revision: "3889c5c0aa" } }).version).toBe("3889c5c")
    expect(chosenOf(orders, { summary: { images: ["registry.example/app:v9"] } }).version).toBe("v9")
    expect(chosenOf(orders, { summary: { images: ["registry:5000/app"] } }).version).toBe("unknown")
  })
})

describe("reading Argo CD", () => {
  const answer = (calls: Call[]) => (call: Call) => {
    calls.push(call)
    if (call.headers?.["authorization"] !== "Bearer argo-token") return reply("no", 401)
    if (call.url === "https://argo.example/api/v1/applications/shop-orders") return reply({ status: synced })
    if (call.url === "https://argo.example/api/v1/applications/odd") return reply({ status: "odd" })
    return undefined
  }

  test("asks for each service's Application with the token, and only those Argo deploys", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.provide(readArgo(argo, [orders, { name: "search", environments: [] }]), stubRemote(answer(calls))),
    ).then((read) => {
      expect(read).toEqual({ orders: { version: "v2.4.0", ready: true, at: "2026-10-03T11:40:00Z" } })
      expect(calls).toHaveLength(1)
    })
  })

  test("says what Argo CD said when it refuses, or answers in another shape", () => {
    const odd: Service = { ...orders, deploy: { argo: { application: "odd" } } }
    const run = (settings: typeof argo | { url: string }, services: ReadonlyArray<Service>) =>
      Effect.runPromise(Effect.result(Effect.provide(readArgo(settings, services), stubRemote(answer([])))))
    return Promise.all([run({ url: "https://argo.example" }, [orders]), run(argo, [odd])]).then(([refused, shaped]) => {
      expect(Result.isFailure(refused) && refused.failure.message).toBe("Argo CD answered 401: no")
      expect(Result.isFailure(shaped) && shaped.failure.message).toBe(
        "Argo CD answered for odd in a shape Estate does not know",
      )
    })
  })

  test("fills an environment's deploys when its sources name Argo CD", () => {
    const configured = { ...settings(), sources: { staging: { argo }, production: {} } }
    const withArgo = { ...catalog, services: [orders] }
    const program = Effect.gen(function* () {
      yield* Effect.forkChild(startSources(configured))
      yield* TestClock.adjust("1 second")
      return (yield* SubscriptionRef.get(yield* Estate)).environments["staging"]?.deploys
    })
    return Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.mergeAll(
            estateLayer(estate({ catalog: withArgo })),
            TestClock.layer(),
            stubRemote(answer([])),
            platform,
          ),
        ),
      ),
    ).then((deploys) => {
      expect(deploys?.state).toBe("ok")
      expect(deploys?.value?.["orders"]?.version).toBe("v2.4.0")
    })
  })
})
