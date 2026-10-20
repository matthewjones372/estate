import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Result } from "effect"
import { readSettings } from "./settings"
import { frameAncestorsOf } from "./settings-web"

const base = `
catalog: /etc/estate/catalog.yaml
auth: { sessionSecret: "${"s".repeat(32)}", roles: { viewer: [], operator: [] }, anonymous: { name: visitor, role: viewer } }
sources: {}
`

const read = (text: string) =>
  Effect.result(readSettings(`${base}${text}`)).pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
  )

describe("the origins that may frame the pages", () => {
  test("are none but Estate's own unless set", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("")
        expect(Result.isSuccess(result) && frameAncestorsOf(result.success.web)).toEqual([])
      }),
    ))

  test("are the origins listed, a wall screen's dashboard among them", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("web: { frameAncestors: [https://grafana.example.com, http://tv.local:8080] }\n")
        expect(Result.isSuccess(result) && frameAncestorsOf(result.success.web)).toEqual([
          "https://grafana.example.com",
          "http://tv.local:8080",
        ])
      }),
    ))

  test("name each that is not an origin, so a policy is never written with a path or a wildcard in it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("web: { frameAncestors: [https://grafana.example.com/d/estate, '*', grafana] }\n")
        expect(Result.isFailure(result) && result.failure.mistakes.map((mistake) => mistake.at)).toEqual([
          "web.frameAncestors[0]",
          "web.frameAncestors[1]",
          "web.frameAncestors[2]",
        ])
      }),
    ))
})
