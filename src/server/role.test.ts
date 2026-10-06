import { describe, expect, test } from "bun:test"
import { Effect, SubscriptionRef } from "effect"
import { ask, environment, estate, serverFor, settings } from "./fixture"
import { ownedBy, Roles, spoken } from "./role"

const readiness = (server: Effect.Success<ReturnType<typeof serverFor>>) =>
  ask(server, new Request("http://estate/readyz")).pipe(Effect.map((each) => [each.status, each.text]))

describe("a runner's role", () => {
  test("keeps a runner unready until each entity's owner has been heard from, then names who reads what", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(settings(), estate({ environments: { production: environment() } }))
        expect(yield* readiness(server)).toEqual([200, "ready"])
        const roles = yield* Effect.provide(Roles, server.context)
        yield* SubscriptionRef.set(roles, { _tag: "Runner", self: "10.0.4.12:34431", owners: {} })
        // The fixture's catalog names staging and production.
        expect(yield* readiness(server)).toEqual([503, "waiting for the owners of estate, staging, production"])
        const own = (entity: string, by: string) => ownedBy(entity, by).pipe(Effect.provideService(Roles, roles))
        yield* own("estate", "10.0.4.12:34431")
        yield* own("env:staging", "10.0.4.12:34431")
        expect(yield* readiness(server)).toEqual([503, "waiting for the owners of production"])
        yield* own("env:production", "10.0.7.3:34431")
        expect(yield* readiness(server)).toEqual([
          200,
          "ready, reading estate, staging; following 10.0.7.3:34431 for production",
        ])
        yield* own("env:production", "10.0.7.3:34431")
        yield* own("env:production", "10.0.4.12:34431")
        expect(yield* readiness(server)).toEqual([200, "ready, reading estate, production, staging"])
      }),
    ))

  test("is said only when clustered, and owners are not tracked for the one process", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(spoken({ _tag: "Alone" })).toBe("")
        const roles = yield* SubscriptionRef.make<Parameters<typeof spoken>[0]>({ _tag: "Alone" })
        yield* ownedBy("estate", "x").pipe(Effect.provideService(Roles, roles))
        expect(yield* SubscriptionRef.get(roles)).toEqual({ _tag: "Alone" })
      }),
    ))
})
