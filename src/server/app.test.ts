import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Fiber, Layer, Result } from "effect"
import { background, prepare, services } from "./app"
import { Notes } from "./notes"
import { stubRemote } from "./remote"
import { SourceFailure } from "./sources/run"
import { stubWeb } from "./web"

const goodSettings = (catalog: string) => `catalog: ${catalog}
auth:
  sessionSecret: a-session-secret-of-at-least-32-characters
  roles: { viewer: [ developers ], operator: [ ops ] }
  anonymous: { name: visitor, role: viewer }
sources:
  staging: { prometheus: { url: http://prometheus:9090 }, kubernetes: {}, flux: {} }
builds: { github: {} }
`

const files = (settings: (catalog: string) => string, catalog: string) => {
  const directory = mkdtempSync(join(tmpdir(), "estate-start-"))
  writeFileSync(join(directory, "catalog.yaml"), catalog)
  writeFileSync(join(directory, "estate.yaml"), settings(join(directory, "catalog.yaml")))
  return join(directory, "estate.yaml")
}

const start = (path: string) => Effect.runPromise(Effect.result(prepare(path)))

describe("starting", () => {
  test("reads both files, and starts every configured source waiting", () =>
    start(files(goodSettings, "environments: [ { name: staging, sources: staging } ]\nservices: []\n")).then(
      (started) => {
        expect(Result.isSuccess(started)).toBe(true)
        if (Result.isFailure(started)) return
        expect(started.success.initial.environments).toEqual({
          staging: {
            metrics: { state: "waiting" },
            alerts: { state: "waiting" },
            cluster: { state: "waiting" },
            deploys: { state: "waiting" },
            resolved: [],
          },
        })
        expect(started.success.initial.builds).toEqual({ state: "waiting" })
      },
    ))

  test("a broken catalog stops it with every mistake named", () =>
    start(
      files(
        goodSettings,
        "environments: [ { name: staging, sources: nowhere } ]\nservices: [ { name: a, environments: [ qa ] } ]\n",
      ),
    ).then((started) => {
      expect(Result.isFailure(started) && started.failure.mistakes.map((mistake) => mistake.message)).toEqual([
        '"qa" is not an environment',
      ])
    }))

  test("an environment whose sources are not set up stops it", () =>
    start(files(goodSettings, "environments: [ { name: staging, sources: nowhere } ]\nservices: []\n")).then(
      (started) => {
        expect(Result.isFailure(started) && started.failure.mistakes[0]?.message).toBe(
          `"nowhere" is not in estate.yaml's sources`,
        )
      },
    ))

  test("broken settings stop it, naming the file", () =>
    start(files(() => "catalog: 1\n", "")).then((started) => {
      expect(Result.isFailure(started) && started.failure.file).toEndWith("estate.yaml")
    }))

  test("settings or a catalog it cannot read stop it", () =>
    Promise.all([start("/nowhere/estate.yaml"), start(files(() => goodSettings("/nowhere/catalog.yaml"), ""))]).then(
      ([settings, catalog]) => {
        expect(Result.isFailure(settings) && settings.failure.mistakes[0]?.message).toBe("cannot be read")
        expect(Result.isFailure(catalog) && catalog.failure.file).toBe("/nowhere/catalog.yaml")
      },
    ))
})

describe("running", () => {
  test("keeps the catalog read beside the routes until it is stopped", () =>
    start(files(goodSettings, "environments: [ { name: staging, sources: staging } ]\nservices: []\n")).then(
      (started) => {
        if (Result.isFailure(started)) return Promise.reject(started.failure)
        const running = Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(background(started.success))
          yield* Effect.promise(() => Bun.sleep(20))
          yield* Fiber.interrupt(fiber)
          return yield* Fiber.await(fiber)
        })
        return Effect.runPromise(
          running.pipe(
            Effect.provide(
              services(
                started.success,
                stubWeb(""),
                stubRemote(() => undefined),
                Layer.succeed(Notes)({
                  all: Effect.fail(new SourceFailure({ message: "the notes database: down" })),
                  add: () => Effect.void,
                  remove: () => Effect.void,
                  removeBefore: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
                }),
              ),
            ),
          ),
        ).then((exit) => {
          expect(exit._tag).toBe("Failure")
        })
      },
    ))
})
