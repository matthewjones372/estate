import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Redacted, Result } from "effect"
import { readSettings, substitute } from "./settings"

const secretOf = (name: string) => `\${${name}}`

const good = `
catalog: /etc/estate/catalog.yaml
auth:
  sessionSecret: ${secretOf("SECRET")}
  roles: { viewer: [ developers ], operator: [ ops ] }
  oidc: { issuer: https://id.example, clientId: estate, clientSecret: ${secretOf("CLIENT_SECRET")}, publicUrl: https://estate.example }
sources:
  home: { prometheus: { url: http://prometheus:9090 } }
`

/** The environment a test reads, in place of the real one. */
const within = (environment: Record<string, string>) =>
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(environment))

const read = (text: string, environment: Record<string, string> = {}) =>
  Effect.result(readSettings(text)).pipe(within(environment))

describe("the settings", () => {
  test("are read with their secrets from the environment", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const read1 = yield* read(good, { SECRET: "s".repeat(32), CLIENT_SECRET: "c" })
        const secret = Result.isSuccess(read1) ? read1.success.auth.oidc?.clientSecret : undefined
        expect(secret === undefined ? undefined : Redacted.value(secret)).toBe("c")
        expect(String(secret)).toBe("<redacted>")
      }),
    ))

  test("name every secret the environment does not set", () =>
    Effect.runPromise(
      substitute(`a: ${secretOf("ONE")}\nb: ${secretOf("TWO")}\nc: ${secretOf("ONE")}`).pipe(within({})),
    ).then((substituted) =>
      expect(Result.isFailure(substituted) && substituted.failure).toEqual([
        { at: secretOf("ONE"), message: "is not set in the environment" },
        { at: secretOf("TWO"), message: "is not set in the environment" },
      ]),
    ))

  test("name every mistake in their shape", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("catalog: 3\nauth: {}\nsources: {}\n")
        expect(Result.isFailure(result) && result.failure.mistakes.map((mistake) => mistake.at)).toEqual([
          "catalog",
          "auth.sessionSecret",
          "auth.roles",
        ])
      }),
    ))

  test("need a way to sign in, and a secret long enough", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read(
          "catalog: c\nauth: { sessionSecret: short, roles: { viewer: [], operator: [] } }\nsources: {}\n",
        )
        expect(Result.isFailure(result) && result.failure.mistakes).toEqual([
          { at: "auth", message: "needs oidc, or anonymous for trying Estate out" },
          { at: "auth.sessionSecret", message: "needs at least 32 characters" },
        ])
      }),
    ))

  test("that are not YAML say so", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* read("catalog: [unclosed")
        expect(Result.isFailure(result) && result.failure.mistakes[0]?.at).toBe("estate.yaml")
      }),
    ))
})
