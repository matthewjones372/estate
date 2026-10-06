/**
 * The estate as a cluster entity, one id for the whole estate, so exactly one runner holds it: that runner runs the
 * readers, sweeps and firing records, sends every follower its state, and applies the writes they made.
 */
import { Duration, Effect, Stream, SubscriptionRef } from "effect"
import { Entity } from "effect/cluster"
import { Rpc } from "effect/rpc"
import { Estate, type EstateState } from "../state"
import { applied } from "../writes"
import { frameOf } from "./frames"
import { Frame, Write } from "./wire"

const Follow = Rpc.make("Follow", { success: Frame, stream: true })
const Apply = Rpc.make("Apply", { payload: { write: Write } })

export const EstateEntity = Entity.make("Estate", [Follow, Apply])

/** The one id: every environment on one owner, as the one process reads them now. */
export const estateId = "estate"

/** Under the time a follower waits before it asks again, so a quiet estate is not taken for a lost owner. */
export const ownerBeat = Duration.seconds(10)

const empty: Frame = { _tag: "Changed", environments: {}, parts: {} }

/** The owner's state as frames: the whole first, then what changed, and an empty change when nothing has. */
export const framesOf = (estate: Estate, owner: string): Stream.Stream<Frame> =>
  Stream.merge(
    SubscriptionRef.changes(estate).pipe(
      Stream.mapAccum(
        (): EstateState | undefined => undefined,
        (before, now) => [now, [frameOf(before, now, owner)]] as const,
      ),
    ),
    Stream.tick(ownerBeat).pipe(Stream.drop(1), Stream.as(empty)),
  )

/**
 * The entity's handlers: on whichever runner holds it, `reading` runs against a state of its own, kept alive for as
 * long as the runner holds the shard and stopped when the shard moves.
 */
export const ownerLayer = <R>(initial: EstateState, reading: Effect.Effect<never, never, Estate | R>) =>
  EstateEntity.toLayer(
    Effect.gen(function* () {
      const estate = yield* SubscriptionRef.make(initial)
      const runner = yield* Entity.CurrentRunnerAddress
      yield* Effect.forkScoped(Effect.provideService(reading, Estate, estate))
      yield* Entity.keepAlive(true)
      return EstateEntity.of({
        Follow: () => framesOf(estate, `${runner.host}:${runner.port}`),
        Apply: ({ payload }) => SubscriptionRef.update(estate, applied(payload.write)),
      })
    }),
    { concurrency: "unbounded" },
  )
