/**
 * The estate as cluster entities, each held by exactly one runner: `estate`, for the estate's own work, and
 * `env:<name>` for each environment's. Whoever holds one runs its work against a state of its own, sends every
 * follower its part of that state, and applies the writes they made to it.
 */
import { Duration, Effect, Stream, SubscriptionRef } from "effect"
import { Entity } from "effect/cluster"
import { Rpc } from "effect/rpc"
import { withCatalog } from "../catalog-file"
import { Configured } from "../settings"
import { Estate, type EstateState } from "../state"
import { applied } from "../writes"
import { frameOf } from "./frames"
import { Frame, Write } from "./wire"

const Follow = Rpc.make("Follow", { success: Frame, stream: true })
const Apply = Rpc.make("Apply", { payload: { write: Write } })

export const EstateEntity = Entity.make("Estate", [Follow, Apply])

/** The estate's own work: its catalog, builds, notes and firings. */
export const estateId = "estate"

/** An environment's entity, and the environment an entity is, if it is one. */
export const environmentId = (name: string) => `env:${name}`
export const environmentOf = (entity: string): string | undefined =>
  entity.startsWith("env:") ? entity.slice("env:".length) : undefined

/** Under the time a follower waits before it asks again, so a quiet estate is not taken for a lost owner. */
export const ownerBeat = Duration.seconds(10)

const empty: Frame = { _tag: "Changed", environments: {}, parts: {} }

/**
 * What an entity sends of its state: for `estate`, all but the environments, which stay as they started; for an
 * environment, that environment alone, the rest as it started, so nothing of the estate's is sent from two owners.
 */
const partOf = (entity: string, initial: EstateState) => {
  const name = environmentOf(entity)
  if (name === undefined) return (state: EstateState): EstateState => ({ ...state, environments: initial.environments })
  return (state: EstateState): EstateState => {
    const mine = state.environments[name]
    return { ...initial, environments: mine === undefined ? {} : { [name]: mine } }
  }
}

/** The owner's state as frames: the whole first, then what changed, and an empty change when nothing has. */
export const framesOf = (
  estate: Estate,
  owner: string,
  part: (state: EstateState) => EstateState = (state) => state,
): Stream.Stream<Frame> =>
  Stream.merge(
    SubscriptionRef.changes(estate).pipe(
      Stream.map(part),
      Stream.mapAccum(
        (): EstateState | undefined => undefined,
        (before, now) => [now, [frameOf(before, now, owner)]] as const,
      ),
    ),
    Stream.tick(ownerBeat).pipe(Stream.drop(1), Stream.as(empty)),
  )

/** An environment's entity keeps the estate's parts it reads, the catalog and firings above all, from the runner's. */
const keepingUp = (mine: Estate, runner: Estate) =>
  Effect.gen(function* () {
    const settings = yield* Configured
    yield* SubscriptionRef.changes(runner).pipe(
      Stream.runForEach((followed) =>
        SubscriptionRef.update(mine, (state) =>
          withCatalog({ ...followed, environments: state.environments }, followed.catalog, settings),
        ),
      ),
    )
  })

/**
 * The entities' handlers: on whichever runner holds one, `work` runs for it against a state of its own, kept alive
 * for as long as the runner holds its shard and stopped when the shard moves.
 */
export const ownerLayer = <R>(
  initial: EstateState,
  work: (entity: string) => Effect.Effect<never, never, Estate | R>,
) =>
  EstateEntity.toLayer(
    Effect.gen(function* () {
      const entity = (yield* Entity.CurrentAddress).entityId
      const estate = yield* SubscriptionRef.make(initial)
      const runner = yield* Entity.CurrentRunnerAddress
      if (environmentOf(entity) !== undefined) yield* Effect.forkScoped(keepingUp(estate, yield* Estate))
      yield* Effect.forkScoped(Effect.provideService(work(entity), Estate, estate))
      yield* Entity.keepAlive(true)
      return EstateEntity.of({
        Follow: () => framesOf(estate, `${runner.host}:${runner.port}`, partOf(entity, initial)),
        Apply: ({ payload }) => SubscriptionRef.update(estate, applied(payload.write)),
      })
    }),
    { concurrency: "unbounded" },
  )
