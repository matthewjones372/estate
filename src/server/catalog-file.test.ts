import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber, Layer, Result, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { configuredKinds, crossCheck, parseCatalog, reloadCatalog, withCatalog } from "./catalog-file"
import { catalog, estate, settings } from "./fixture"
import { platform } from "./platform"
import { Estate, estateLayer } from "./state"

describe("the catalog file", () => {
  test("that is not YAML says so", () => {
    const parsed = parseCatalog("c.yaml", "services: [unclosed")
    expect(Result.isFailure(parsed) && parsed.failure.mistakes[0]?.message).toStartWith("is not YAML")
  })

  test("names the environments whose sources the settings lack", () => {
    const configured = { ...settings(), sources: { staging: {} } }
    expect(crossCheck(configured, catalog)).toEqual([
      { at: "environments[1] (production).sources", message: '"production" is not in estate.yaml\'s sources' },
    ])
  })

  test("knows which sources an environment has from its section", () => {
    const configured = {
      ...settings(),
      sources: {
        a: { prometheus: { url: "p" } },
        b: { alertmanager: { url: "a" }, kubernetes: {}, flux: {} },
        c: { flux: {} },
        d: { grafana: { url: "g" } },
        e: { argo: { url: "a" } },
        f: { aws: { region: "eu-west-2" } },
      },
    }
    expect([...configuredKinds(configured, "a")]).toEqual(["metrics", "alerts"])
    expect([...configuredKinds(configured, "b")]).toEqual(["alerts", "cluster", "deploys"])
    expect([...configuredKinds(configured, "c")]).toEqual([])
    expect([...configuredKinds(configured, "d")]).toEqual(["alerts"])
    expect([...configuredKinds(configured, "e")]).toEqual(["deploys"])
    expect([...configuredKinds(configured, "f")]).toEqual(["cluster", "deploys"])
  })

  test("a new catalog keeps what is known of environments it keeps, and forgets the rest", () => {
    const before = estate()
    const after = withCatalog(
      before,
      {
        ...catalog,
        environments: [
          { name: "staging", sources: "staging" },
          { name: "qa", sources: "staging" },
        ],
      },
      settings(),
    )
    expect(Object.keys(after.environments)).toEqual(["staging", "qa"])
    expect(Object.values(after.environments)[0]).toBe(Object.values(before.environments)[0])
  })

  test("is taken again when it changes and checks out, and left alone when it does not", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const directory = mkdtempSync(join(tmpdir(), "estate-catalog-"))
        const path = join(directory, "catalog.yaml")
        const text = "environments: [ { name: staging, sources: staging } ]\nservices: []\n"
        writeFileSync(path, text)
        const configured = { ...settings(), catalog: path }
        const program = Effect.gen(function* () {
          const ref = yield* Estate
          const fiber = yield* Effect.forkChild(reloadCatalog(path, configured, text).pipe(Effect.provide(platform)))
          writeFileSync(
            path,
            "environments: [ { name: staging, sources: staging } ]\nservices: [ { name: shop, environments: [ staging ] } ]\n",
          )
          yield* TestClock.adjust("11 seconds")
          yield* Effect.promise(() => Bun.sleep(50))
          const taken = (yield* SubscriptionRef.get(ref)).catalog.services.map((service) => service.name)
          writeFileSync(path, "environments: []\n")
          yield* TestClock.adjust("11 seconds")
          yield* Effect.promise(() => Bun.sleep(50))
          const kept = (yield* SubscriptionRef.get(ref)).catalog.services.map((service) => service.name)
          yield* Fiber.interrupt(fiber)
          return { taken, kept }
        })
        const result = yield* program.pipe(Effect.provide(Layer.merge(estateLayer(estate()), TestClock.layer())))
        expect(result).toEqual({ taken: ["shop"], kept: ["shop"] })
      }),
    ))
})
