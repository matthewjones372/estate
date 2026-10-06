/**
 * Every runner, the owner too, follows the estate entity into its own `Estate`, which the routes, shared views and
 * `/mcp` read as they always have. When the owner goes, the last state stays on the pages until the next owner's.
 */
import { Data, Duration, Effect, Layer, Ref, Stream, SubscriptionRef } from "effect"
import type { Sharding } from "effect/cluster/Sharding"
import { ShardingConfig } from "effect/cluster/ShardingConfig"
import { becomes, type Roles } from "../role"
import { backOff } from "../schedule"
import { Estate } from "../state"
import { Writes } from "../writes"
import { followed } from "./frames"
import { EstateEntity, estateId, ownerBeat } from "./owner"

const Unfollowed = Data.TaggedError("Unfollowed")<{ readonly message: string }>

/** Three of the owner's beats missed is an owner gone. */
const missed = Duration.times(ownerBeat, 3)

const addressOf = (config: typeof ShardingConfig.Service) =>
  config.runnerAddress._tag === "Some" ? `${config.runnerAddress.value.host}:${config.runnerAddress.value.port}` : ""

/** One following, for as long as the owner sends; it fails only if nothing came, so it is tried again more slowly. */
const followOnce = Effect.gen(function* () {
  const estate = yield* Estate
  const self = addressOf(yield* ShardingConfig)
  const owner = (yield* EstateEntity.client)(estateId)
  const frames = yield* Ref.make(0)
  yield* owner.Follow().pipe(
    Stream.timeout(missed),
    Stream.runForEach((frame) =>
      Effect.gen(function* () {
        yield* Ref.update(frames, (count) => count + 1)
        if (frame._tag === "Whole")
          yield* becomes(frame.owner === self ? { _tag: "Reading" } : { _tag: "Following", owner: frame.owner })
        yield* SubscriptionRef.update(estate, (state) => followed(state, frame))
      }),
    ),
    Effect.catchCause(Effect.logWarning),
    Effect.annotateLogs("following", "the estate's owner"),
  )
  if ((yield* Ref.get(frames)) === 0) return yield* new Unfollowed({ message: "the estate's owner sent nothing" })
})

/** Follows the estate for as long as this runner serves. */
export const follow: Effect.Effect<never, never, Estate | Roles | Sharding | ShardingConfig> = followOnce.pipe(
  Effect.retry(backOff),
  Effect.orDie,
  Effect.forever,
)

/** Writes go to the owner, which shows them to every runner on its next frame. */
export const ownerWrites = Layer.effect(Writes)(
  Effect.gen(function* () {
    const owner = (yield* EstateEntity.client)(estateId)
    return {
      apply: (write) =>
        owner
          .Apply({ write })
          .pipe(
            Effect.retry({ schedule: backOff, times: 3 }),
            Effect.catchCause(Effect.logWarning),
            Effect.annotateLogs("writing to", "the estate's owner"),
          ),
    }
  }),
)
