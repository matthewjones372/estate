import { describe, expect, test } from "bun:test"
import { Effect, Layer, Ref, Stream, SubscriptionRef } from "effect"
import { ShardingConfig, TestRunner } from "effect/cluster"
import { environment, estate } from "../fixture"
import { Roles, roleLayer } from "../role"
import { Estate, estateLayer, updateEnvironment } from "../state"
import { written } from "../writes"
import { follow, ownerWrites } from "./follow"
import { ownerLayer } from "./owner"

const initial = estate({ environments: { production: environment() } })

/** An owner whose reading counts its starts and then marks the production metrics read. */
const cluster = (starts: Ref.Ref<number>) =>
  ownerLayer(
    initial,
    Effect.gen(function* () {
      yield* Ref.update(starts, (count) => count + 1)
      yield* updateEnvironment("production", (state) => ({ ...state, metrics: { state: "failing", message: "read" } }))
      return yield* Effect.never
    }),
  ).pipe(Layer.provideMerge(Layer.merge(TestRunner.layer, ShardingConfig.layer())))

const runner = Layer.mergeAll(estateLayer(initial), roleLayer({ _tag: "Joining" }))

describe("the estate entity", () => {
  test("starts its readers once however many follow, and each follower gets the owner's state", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const starts = yield* Ref.make(0)
        yield* Effect.gen(function* () {
          yield* Effect.forEach([1, 2, 3], () => Effect.forkScoped(follow))
          const ref = yield* Estate
          const read = yield* SubscriptionRef.changes(ref).pipe(
            Stream.filter((state) => state.environments["production"]?.metrics.message === "read"),
            Stream.runHead,
          )
          expect(read._tag).toBe("Some")
          expect(yield* Ref.get(starts)).toBe(1)
          expect((yield* SubscriptionRef.get(yield* Roles))._tag).toBe("Reading")
        }).pipe(Effect.scoped, Effect.provide(runner), Effect.provide(cluster(starts)))
      }),
    ))

  test("applies a follower's write and sends it back on the next frame", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const starts = yield* Ref.make(0)
        yield* Effect.gen(function* () {
          yield* Effect.forkScoped(follow)
          yield* written({
            _tag: "NoteAdded",
            note: {
              id: "n1",
              environment: "production",
              alert: "a",
              at: "2026-10-06T00:00:00Z",
              by: "Ada",
              text: "on it",
            },
          })
          const noted = yield* SubscriptionRef.changes(yield* Estate).pipe(
            Stream.filter((state) => state.notes.some((note) => note.id === "n1")),
            Stream.runHead,
          )
          expect(noted._tag).toBe("Some")
        }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(runner, ownerWrites)), Effect.provide(cluster(starts)))
      }),
    ))
})
