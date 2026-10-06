/**
 * Every runner, owners too, follows the estate's entities into its own `Estate`, which the routes, shared views and
 * `/mcp` read as they always have: `estate` for the estate's own parts, and each environment's entity for that
 * environment, the environments followed changing as the catalog does. When an owner goes, the last state of what it
 * owned stays on the pages until the next owner's arrives.
 */
import { Data, Duration, Effect, FiberMap, Layer, Ref, Stream, SubscriptionRef } from "effect"
import type { Sharding } from "effect/cluster/Sharding"
import type { ShardingConfig } from "effect/cluster/ShardingConfig"
import { withCatalog } from "../catalog-file"
import { ownedBy, type Roles } from "../role"
import { backOff } from "../schedule"
import { Configured } from "../settings"
import { Estate } from "../state"
import { Writes } from "../writes"
import { followed, type Owned } from "./frames"
import { EstateEntity, environmentId, environmentOf, estateId, ownerBeat } from "./owner"
import type { Write } from "./wire"

const Unfollowed = Data.TaggedError("Unfollowed")<{ readonly message: string }>

/** Three of the owner's beats missed is an owner gone. */
const missed = Duration.times(ownerBeat, 3)

/** This runner's address, as owners name themselves in their frames. */
export const selfOf = (config: typeof ShardingConfig.Service) =>
  config.runnerAddress._tag === "Some" ? `${config.runnerAddress.value.host}:${config.runnerAddress.value.port}` : ""

/** One following of one entity, for as long as its owner sends; it fails only if nothing came, so it is tried again. */
const followOnce = (entity: string) =>
  Effect.gen(function* () {
    const estate = yield* Estate
    const settings = yield* Configured
    const name = environmentOf(entity)
    const from: Owned =
      name === undefined
        ? { _tag: "Estate", withCatalog: (state, catalog) => withCatalog(state, catalog, settings) }
        : { _tag: "Environment", name }
    const owner = (yield* EstateEntity.client)(entity)
    const frames = yield* Ref.make(0)
    yield* owner.Follow().pipe(
      Stream.timeout(missed),
      Stream.runForEach((frame) =>
        Effect.gen(function* () {
          // Only this entity's fiber writes its part of the state, and each update is one, so they cannot interleave.
          const next = yield* SubscriptionRef.modify(estate, (state) => {
            const taken = followed(state, frame, from)
            return [taken, taken._tag === "Success" ? taken.success : state] as const
          })
          if (next._tag === "Failure") return yield* new Unfollowed({ message: next.failure })
          yield* Ref.update(frames, (count) => count + 1)
          if (frame._tag === "Whole") yield* ownedBy(entity, frame.owner)
        }),
      ),
      Effect.catchCause(Effect.logWarning),
      Effect.annotateLogs("following", entity),
    )
    if ((yield* Ref.get(frames)) === 0) return yield* new Unfollowed({ message: `${entity}'s owner sent nothing` })
  })

const followEntity = (entity: string) => followOnce(entity).pipe(Effect.retry(backOff), Effect.orDie, Effect.forever)

/** Follows the estate and each of its environments for as long as this runner serves. */
export const follow: Effect.Effect<never, never, Estate | Roles | Sharding | ShardingConfig | Configured> = Effect.gen(
  function* () {
    const fibers = yield* FiberMap.make<string>()
    const estate = yield* Estate
    yield* FiberMap.run(fibers, estateId, followEntity(estateId))
    return yield* SubscriptionRef.changes(estate).pipe(
      Stream.map((state) => state.catalog.environments.map((each) => each.name).join("\u0000")),
      Stream.changes,
      Stream.runForEach((names) =>
        Effect.gen(function* () {
          const wanted = new Set(names === "" ? [] : names.split("\u0000").map(environmentId))
          for (const [entity] of [...fibers])
            if (entity !== estateId && !wanted.has(entity)) yield* FiberMap.remove(fibers, entity)
          for (const entity of wanted)
            yield* FiberMap.run(fibers, entity, followEntity(entity), { onlyIfMissing: true })
        }),
      ),
      Effect.andThen(Effect.never),
    )
  },
).pipe(Effect.scoped)

/** The entity that owns what a write changes: an environment's silences and debug, else the estate's. */
const ownerOf = (write: Write): string =>
  write._tag === "Held" || write._tag === "Unheld" || write._tag === "DebugShown"
    ? environmentId(write.environment)
    : estateId

/** Writes go to their owner, which shows them to every runner on its next frame. */
export const ownerWrites = Layer.effect(Writes)(
  Effect.gen(function* () {
    const clientFor = yield* EstateEntity.client
    return {
      apply: (write: Write) =>
        clientFor(ownerOf(write))
          .Apply({ write })
          .pipe(
            Effect.retry({ schedule: backOff, times: 3 }),
            Effect.catchCause(Effect.logWarning),
            Effect.annotateLogs("writing to", ownerOf(write)),
          ),
    }
  }),
)
