import { describe, expect, test } from "bun:test"
import { Duration, Effect, Fiber, Redacted, Stream, SubscriptionRef } from "effect"
import type { Service } from "../../shared/catalog"
import { codeFinding } from "../doctor-code"
import { catalog, estate } from "../fixture"
import { type Call, reply, stubRemote } from "../remote"
import type { Code } from "../settings-code"
import { Estate } from "../state"
import { readCode, runCode } from "./code"
import { codeEvery } from "./every"

const tools: Code = {
  sonarqube: { url: "https://sonar.example/", token: Redacted.make("sonar-token") },
  github: { token: Redacted.make("gh-token"), url: "https://github.example/api" },
}

const services: ReadonlyArray<Service> = [
  {
    name: "storefront",
    environments: [],
    repository: "github:acme/storefront",
    code: { sonarqube: { project: "shop:storefront" } },
  },
  { name: "orders", environments: [], repository: "github:acme/orders" },
  { name: "payments", environments: [] },
]

/** SonarQube and GitHub: storefront analysed with alerts of each kind; orders without code scanning. */
const answer =
  (calls: Array<Call>, sonarDown = false) =>
  (call: Call) => {
    calls.push(call)
    const url = new URL(call.url)
    if (url.host === "sonar.example") {
      if (sonarDown) return reply({ errors: [{ msg: "down" }] }, 500)
      return url.pathname.endsWith("project_status")
        ? reply({ projectStatus: { status: "ERROR" } })
        : reply({
            component: {
              measures: [
                { metric: "coverage", value: "71.4" },
                { metric: "bugs", value: "3" },
                { metric: "vulnerabilities", value: "1" },
                { metric: "code_smells", value: "40" },
              ],
            },
          })
    }
    if (url.pathname === "/api/repos/acme/storefront/dependabot/alerts")
      return reply([{ security_advisory: { severity: "critical" } }, { security_advisory: { severity: "high" } }])
    if (url.pathname === "/api/repos/acme/storefront/code-scanning/alerts")
      return reply([
        { rule: { security_severity_level: "high" } },
        { rule: { severity: "warning", security_severity_level: null } },
      ])
    if (url.pathname === "/api/repos/acme/orders/dependabot/alerts") return reply([])
    if (url.pathname === "/api/repos/acme/orders/code-scanning/alerts")
      return reply({ message: "no analysis found" }, 404)
    return undefined
  }

describe("a service's code health", () => {
  test("is its SonarQube gate and measures, and its open alerts by severity", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: Array<Call> = []
        const { health, failures } = yield* readCode(tools, services).pipe(Effect.provide(stubRemote(answer(calls))))
        expect(failures).toEqual([])
        expect(health).toEqual({
          storefront: {
            sonarqube: {
              gate: "failed",
              coverage: 71.4,
              bugs: 3,
              vulnerabilities: 1,
              smells: 40,
              href: "https://sonar.example/dashboard?id=shop%3Astorefront",
            },
            dependabot: {
              alerts: { critical: 1, high: 1, medium: 0, low: 0 },
              href: "https://github.com/acme/storefront/security/dependabot",
            },
            scanning: {
              alerts: { critical: 0, high: 1, medium: 1, low: 0 },
              href: "https://github.com/acme/storefront/security/code-scanning",
            },
          },
          // No code scanning on orders, a 404, is none rather than a failure; payments names neither tool.
          orders: {
            dependabot: {
              alerts: { critical: 0, high: 0, medium: 0, low: 0 },
              href: "https://github.com/acme/orders/security/dependabot",
            },
          },
        })
        const sonar = calls.find((call) => call.url.includes("project_status"))
        expect(sonar?.headers?.["authorization"]).toBe("Bearer sonar-token")
      }),
    ))

  test("keeps the other tools' readings when one fails, and says which", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { health, failures } = yield* readCode(tools, services).pipe(Effect.provide(stubRemote(answer([], true))))
        expect(failures).toEqual(['storefront: SonarQube answered 500: {"errors":[{"msg":"down"}]}'])
        expect(health["storefront"]?.sonarqube).toBeUndefined()
        expect(health["storefront"]?.dependabot?.alerts.critical).toBe(1)
      }),
    ))

  test("is read into the estate, and said by the doctor", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const written = { ...catalog, services: [...services] }
        const ref = yield* SubscriptionRef.make(estate({ catalog: written }))
        const fiber = yield* Effect.forkChild(
          runCode(tools, "1 hour").pipe(
            Effect.provideService(Estate, ref),
            Effect.provide(stubRemote(answer([], true))),
          ),
        )
        const read = yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((state) => state.code !== undefined),
          Stream.runHead,
        )
        yield* Fiber.interrupt(fiber)
        expect(read._tag === "Some" && read.value.code?.state).toBe("ok")
        expect(read._tag === "Some" && read.value.code?.message).toBe(
          'storefront: SonarQube answered 500: {"errors":[{"msg":"down"}]}',
        )
        const said = yield* codeFinding(tools, written).pipe(Effect.provide(stubRemote(answer([], true))))
        expect(said).toEqual({
          part: "code",
          ok: false,
          says: 'storefront: SonarQube answered 500: {"errors":[{"msg":"down"}]}; storefront 1 critical, 2 high, 1 medium alerts; orders no open alerts',
        })
        expect(yield* codeFinding(undefined, written).pipe(Effect.provide(stubRemote(answer([]))))).toBeUndefined()
      }),
    ))

  test("is read every 15 minutes unless the settings say otherwise", () => {
    expect(Duration.toMinutes(codeEvery({}))).toBe(15)
    expect(Duration.toMinutes(codeEvery({ every: "1h" }))).toBe(60)
  })
})
