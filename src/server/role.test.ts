import { describe, expect, test } from "bun:test"
import { Effect, SubscriptionRef } from "effect"
import { ask, environment, estate, serverFor, settings } from "./fixture"
import { becomes, Roles, spoken } from "./role"

const readiness = (server: Effect.Success<ReturnType<typeof serverFor>>) =>
  ask(server, new Request("http://estate/readyz")).pipe(Effect.map((each) => [each.status, each.text]))

describe("a runner's role", () => {
  test("keeps a joining runner unready until the owner's state arrives, then names what it is", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(settings(), estate({ environments: { production: environment() } }))
        expect(yield* readiness(server)).toEqual([200, "ready"])
        const roles = yield* Effect.provide(Roles, server.context)
        yield* SubscriptionRef.set(roles, { _tag: "Joining" })
        expect(yield* readiness(server)).toEqual([503, "waiting for the estate's owner"])
        yield* becomes({ _tag: "Following", owner: "10.0.4.12:34431" }).pipe(Effect.provideService(Roles, roles))
        expect(yield* readiness(server)).toEqual([200, "ready, following 10.0.4.12:34431"])
        yield* becomes({ _tag: "Reading" }).pipe(Effect.provideService(Roles, roles))
        expect(yield* readiness(server)).toEqual([200, "ready, reading"])
      }),
    ))

  test("is said only when clustered", () => {
    expect(spoken({ _tag: "Alone" })).toBe("")
    expect(spoken({ _tag: "Joining" })).toBe("")
  })
})
