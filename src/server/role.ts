/**
 * What this process is to the estate: the one process, or one runner of a cluster, which reads some of the estate's
 * entities (the estate's own work, and each environment's) and follows the runners that read the rest. `/readyz`
 * says it, and a runner is not ready until it has been sent the estate and every environment once.
 */
import { Context, Effect, Layer, Metric, SubscriptionRef } from "effect"

export type Role =
  | { readonly _tag: "Alone" }
  /** By entity, `estate` or `env:<name>`, the runner that reads it, as its frames last said. */
  | { readonly _tag: "Runner"; readonly self: string; readonly owners: Readonly<Record<string, string>> }

export type Roles = SubscriptionRef.SubscriptionRef<Role>
export const Roles = Context.Service<Roles>("estate/Role")

export const roleLayer = (role: Role) => Layer.effect(Roles)(SubscriptionRef.make(role))

/** How many of the estate's entities this runner reads, for an alert on none being read, or one read twice. */
const owner = Metric.gauge("estate_cluster_owner", { description: "the estate's entities this runner reads" })

const nameOf = (entity: string) => entity.replace(/^env:/, "")

/** The entities not yet heard from: the estate, and each environment the catalog names. */
export const awaited = (role: Role, environments: ReadonlyArray<string>): ReadonlyArray<string> =>
  role._tag === "Alone"
    ? []
    : ["estate", ...environments.map((name) => `env:${name}`)]
        .filter((entity) => role.owners[entity] === undefined)
        .map(nameOf)

/** The role as `/readyz` says it, after `ready`: what this runner reads, and whom it follows for the rest. */
export const spoken = (role: Role): string => {
  if (role._tag === "Alone") return ""
  // The estate first, then its environments by name.
  const entries = Object.entries(role.owners).sort(([a], [b]) =>
    a === "estate" ? -1 : b === "estate" ? 1 : a.localeCompare(b),
  )
  const read = entries.filter(([, by]) => by === role.self).map(([entity]) => nameOf(entity))
  const byOwner = new Map<string, Array<string>>()
  for (const [entity, by] of entries)
    if (by !== role.self) byOwner.set(by, [...(byOwner.get(by) ?? []), nameOf(entity)])
  return [
    ...(read.length === 0 ? [] : [`reading ${read.join(", ")}`]),
    ...(byOwner.size === 0
      ? []
      : [`following ${[...byOwner].map(([by, names]) => `${by} for ${names.join(", ")}`).join("; ")}`]),
  ].join("; ")
}

/** That `entity` is read by `by`: logged when that changes, and counted in the owner gauge. */
export const ownedBy = (entity: string, by: string): Effect.Effect<void, never, Roles> =>
  Effect.gen(function* () {
    const roles = yield* Roles
    const role = yield* SubscriptionRef.get(roles)
    if (role._tag === "Alone" || role.owners[entity] === by) return
    const now: Role = { ...role, owners: { ...role.owners, [entity]: by } }
    yield* SubscriptionRef.set(roles, now)
    yield* Effect.logInfo(
      by === role.self ? `this runner now reads ${nameOf(entity)}` : `${nameOf(entity)} is read by ${by}`,
    )
    yield* Metric.update(owner, Object.values(now.owners).filter((each) => each === role.self).length)
  })
