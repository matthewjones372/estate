import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Result } from "effect"
import { readSettings } from "./settings"

const base = `
catalog: /etc/estate/catalog.yaml
auth: { sessionSecret: "${"s".repeat(32)}", roles: { viewer: [], operator: [] }, anonymous: { name: visitor, role: viewer } }
sources: {}
`

const read = (text: string) =>
  Effect.result(readSettings(`${base}${text}`)).pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
  )

describe("Estate's database in the settings", () => {
  test("is Postgres or DynamoDB at the top, beside how long notes are kept", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("database: { postgres: postgres://estate@db/estate }\nnotes: { keepDays: 7 }\n")
        expect(Result.isSuccess(result) && result.success.notes?.keepDays).toBe(7)
        expect(Result.isSuccess(result) && result.success.database?.postgres !== undefined).toBe(true)
      }),
    ))

  test("is one or the other, not both", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read(
          "database: { postgres: postgres://estate@db/estate, dynamodb: { table: notes, region: eu-west-1 } }\n",
        )
        expect(Result.isFailure(result) && result.failure.mistakes).toEqual([
          { at: "database", message: "is postgres or dynamodb, not both" },
        ])
      }),
    ))

  test("named under notes says where it is set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read(
          "notes: { postgres: postgres://estate@db/estate, dynamodb: { table: notes, region: eu-west-1 } }\n",
        )
        expect(Result.isFailure(result) && result.failure.mistakes).toEqual([
          { at: "notes.postgres", message: "Estate's database is set as database.postgres" },
          { at: "notes.dynamodb", message: "Estate's database is set as database.dynamodb" },
        ])
      }),
    ))
})
