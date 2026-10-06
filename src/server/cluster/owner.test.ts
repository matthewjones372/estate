import { describe, expect, test } from "bun:test"
import { Effect, Layer, Ref, Stream, SubscriptionRef } from "effect"
import { ShardingConfig, TestRunner } from "effect/cluster"
import { environment, estate, settings } from "../fixture"
import { Roles, roleLayer } from "../role"
import { Configured } from "../settings"
import { Estate, type EstateState, estateLayer, updateEnvironment, updateEstate } from "../state"
import { written } from "../writes"
import { follow, ownerWrites } from "./follow"
import { EstateEntity, environmentOf, estateId, ownerLayer } from "./owner"

const self = "localhost:34431"
const initial = estate({
  environments: {
    staging: environment(),
    production: environment({ cluster: { state: "ok", value: { pods: {}, debug: {} } } }),
  },
})

const firing = { environment: "production", alert: "a1", name: "OrdersSlow", startsAt: "2026-10-06T00:00:00Z" }

/** Each entity's work counts its starts and marks its part read; production also records a firing for the estate. */
const cluster = (starts: Ref.Ref<Readonly<Record<string, number>>>) =>
  ownerLayer(initial, (entity) =>
    Effect.gen(function* () {
      yield* Ref.update(starts, (counted) => ({ ...counted, [entity]: (counted[entity] ?? 0) + 1 }))
      const name = environmentOf(entity)
      if (name === undefined) yield* updateEstate((state) => ({ ...state, firings: [] }))
      else yield* updateEnvironment(name, (state) => ({ ...state, metrics: { state: "failing", message: "read" } }))
      if (name === "production")
        yield* Effect.flatMap(EstateEntity.client, (clientFor) =>
          clientFor(estateId).Apply({ write: { _tag: "FiringsKept", firings: [firing] } }),
        ).pipe(Effect.orDie)
      return yield* Effect.never
    }),
  ).pipe(Layer.provideMerge(Layer.merge(TestRunner.layer, ShardingConfig.layer())))

const runner = Layer.mergeAll(
  estateLayer(initial),
  roleLayer({ _tag: "Runner", self, owners: {} }),
  Layer.succeed(Configured)(settings()),
)

const until = (holds: (state: EstateState) => boolean) =>
  Effect.gen(function* () {
    return yield* SubscriptionRef.changes(yield* Estate).pipe(Stream.filter(holds), Stream.runHead)
  })

const read = (state: EstateState, name: string) => state.environments[name]?.metrics.message === "read"

describe("the estate's entities", () => {
  test("each run their own work once, and a follower has every environment from its owner", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const starts = yield* Ref.make<Readonly<Record<string, number>>>({})
        yield* Effect.gen(function* () {
          yield* Effect.forkScoped(follow)
          yield* Effect.forkScoped(follow)
          const state = yield* until(
            (each) =>
              read(each, "staging") &&
              read(each, "production") &&
              each.firings?.some((one) => one.alert === "a1") === true,
          )
          expect(state._tag).toBe("Some")
          expect(yield* Ref.get(starts)).toEqual({ estate: 1, "env:staging": 1, "env:production": 1 })
          const role = yield* SubscriptionRef.get(yield* Roles)
          expect(role._tag === "Runner" && role.owners).toEqual({
            estate: self,
            "env:staging": self,
            "env:production": self,
          })
        }).pipe(Effect.scoped, Effect.provide(cluster(starts).pipe(Layer.provideMerge(runner))))
      }),
    ))

  test("take each write to the entity that owns what it changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const starts = yield* Ref.make<Readonly<Record<string, number>>>({})
        yield* Effect.gen(function* () {
          yield* Effect.forkScoped(follow)
          yield* until((each) => read(each, "production"))
          yield* written({
            _tag: "NoteAdded",
            note: {
              id: "n1",
              environment: "production",
              alert: "a1",
              at: "2026-10-06T00:00:00Z",
              by: "Ada",
              text: "on it",
            },
          })
          yield* written({
            _tag: "DebugShown",
            environment: "production",
            service: "storefront",
            debug: { level: "DEBUG", on: true },
          })
          const shown = yield* until(
            (each) =>
              each.notes.some((note) => note.id === "n1") &&
              each.environments["production"]?.cluster.value?.debug["storefront"]?.on === true,
          )
          expect(shown._tag).toBe("Some")
        }).pipe(
          Effect.scoped,
          Effect.provide(ownerWrites.pipe(Layer.provideMerge(cluster(starts)), Layer.provideMerge(runner))),
        )
      }),
    ))
})
