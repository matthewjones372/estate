import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Result } from "effect"
import { readSettings } from "./settings"
import { leadMinutes, suggestWithin } from "./settings-incidents"

const base = `
catalog: /etc/estate/catalog.yaml
auth: { sessionSecret: "${"s".repeat(32)}", roles: { viewer: [], operator: [] }, anonymous: { name: visitor, role: viewer } }
sources: {}
`

const read = (text: string) =>
  Effect.result(readSettings(`${base}${text}`)).pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
  )

describe("how far apart two firings may start and still be suggested together", () => {
  test("is 30 minutes unless set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("")
        expect(Result.isSuccess(result) && suggestWithin(result.success.incidents)).toBe(30)
      }),
    ))

  test("is read as a duration", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("incidents: { suggestWithin: 1h }\n")
        expect(Result.isSuccess(result) && suggestWithin(result.success.incidents)).toBe(60)
      }),
    ))

  test("is a mistake when it is not a duration", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("incidents: { suggestWithin: soon }\n")
        expect(Result.isFailure(result) && result.failure.mistakes).toEqual([
          { at: "incidents.suggestWithin", message: '"soon" is not a duration: write 30s, 2m or 1h' },
        ])
      }),
    ))
})

describe("how far before its first firing an incident's window starts", () => {
  test("is 30 minutes unless set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("")
        expect(Result.isSuccess(result) && leadMinutes(result.success.incidents)).toBe(30)
      }),
    ))

  test("is a mistake when it is less than none", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("incidents: { leadMinutes: -5 }\n")
        expect(Result.isFailure(result) && result.failure.mistakes).toEqual([
          { at: "incidents.leadMinutes", message: "-5 is not a number of minutes: write 0 or more" },
        ])
      }),
    ))
})
