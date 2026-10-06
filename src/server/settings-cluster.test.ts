import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Result } from "effect"
import { readSettings } from "./settings"
import { clusteredBy } from "./settings-cluster"

const base = `
catalog: /etc/estate/catalog.yaml
auth: { sessionSecret: "${"s".repeat(32)}", roles: { viewer: [], operator: [] }, anonymous: { name: visitor, role: viewer } }
sources: {}
`

const read = (text: string) =>
  Effect.result(readSettings(`${base}${text}`)).pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
  )

describe("cluster in the settings", () => {
  test("is one boolean, with Estate's Postgres", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("cluster: true\ndatabase: { postgres: postgres://estate@db/estate }\n")
        expect(Result.isSuccess(result) && clusteredBy(result.success.cluster)).toEqual({ port: 34431, health: "ping" })
      }),
    ))

  test("overrides only what it names", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("cluster: { health: k8s }\ndatabase: { postgres: postgres://estate@db/estate }\n")
        expect(Result.isSuccess(result) && clusteredBy(result.success.cluster)).toEqual({ port: 34431, health: "k8s" })
      }),
    ))

  test("needs database.postgres, which DynamoDB is not", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const notes of ["", "database: { dynamodb: { table: notes, region: eu-west-1 } }\n"]) {
          const result = yield* read(`cluster: true\n${notes}`)
          expect(Result.isFailure(result) && result.failure.mistakes).toEqual([
            { at: "cluster", message: "needs database.postgres, where the runners find each other" },
          ])
        }
      }),
    ))

  test("absent or false is the one process", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(clusteredBy(undefined)).toBeUndefined()
        const result = yield* read("cluster: false\n")
        expect(Result.isSuccess(result) && clusteredBy(result.success.cluster)).toBeUndefined()
      }),
    ))

  test("in examples/cluster/, two runners differ only in their ports", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const runners = yield* Effect.forEach(["a", "b"], (name) =>
          Effect.promise(() => Bun.file(new URL(`../../examples/cluster/${name}.yaml`, import.meta.url)).text()).pipe(
            Effect.flatMap(readSettings),
            Effect.provideService(
              ConfigProvider.ConfigProvider,
              ConfigProvider.fromUnknown({ DATABASE_URL: "postgres://estate@localhost/estate" }),
            ),
          ),
        )
        expect(runners.map((each) => clusteredBy(each.cluster)?.port)).toEqual([34431, 34432])
        expect(runners.map((each) => each.port)).toEqual([8080, 8081])
      }),
    ))
})
