/**
 * What this process is to the estate: the one process, or one runner of a cluster that reads the estate or follows
 * the runner that does. `/readyz` says it, and a follower is not ready until the owner's whole state has arrived.
 */
import { Context, Effect, Layer, Metric, SubscriptionRef } from "effect"

export type Role =
  | { readonly _tag: "Alone" }
  | { readonly _tag: "Joining" }
  | { readonly _tag: "Reading" }
  | { readonly _tag: "Following"; readonly owner: string }

export type Roles = SubscriptionRef.SubscriptionRef<Role>
export const Roles = Context.Service<Roles>("estate/Role")

export const roleLayer = (role: Role) => Layer.effect(Roles)(SubscriptionRef.make(role))

/** 1 on the runner that reads the estate, 0 on the others, for an alert on there being none, or two. */
const owner = Metric.gauge("estate_cluster_owner", { description: "1 on the runner that reads the estate" })

/** The role as `/readyz` says it, after `ready`. */
export const spoken = (role: Role): string =>
  role._tag === "Reading" ? "reading" : role._tag === "Following" ? `following ${role.owner}` : ""

/** A runner's role now, logged when it changes and counted in the owner gauge. */
export const becomes = (role: Role): Effect.Effect<void, never, Roles> =>
  Effect.gen(function* () {
    const roles = yield* Roles
    const was = yield* SubscriptionRef.getAndSet(roles, role)
    if (spoken(was) !== spoken(role)) yield* Effect.logInfo(`this runner is now ${spoken(role)}`)
    yield* Metric.update(owner, role._tag === "Reading" ? 1 : 0)
  })
