/**
 * The frames `Follow` sends, and how a follower takes them in: the whole estate first, then how each part that
 * changed did, found by reference as the event stream finds them and said as a patch, so a read that moved every
 * service's series along a point sends those points and nothing else.
 */
import { Result } from "effect"
import type { EnvironmentState, EstateState } from "../state"
import { applied, diff, type Patch } from "./patch"
import { decodeEnvironment, decodeParts, environmentParts, estateParts, type Frame, fromWire, toWire } from "./wire"

const sameNames = (before: EstateState, now: EstateState): boolean => {
  const was = Object.keys(before.environments)
  const is = Object.keys(now.environments)
  return was.length === is.length && was.every((name) => now.environments[name] !== undefined)
}

/** Each part that changed, by reference, as a patch; a part that is gone is not sent. */
const patches = <T extends object>(keys: ReadonlyArray<string>, was: T, is: T): Readonly<Record<string, Patch>> =>
  Object.fromEntries(
    keys.flatMap((key) => {
      const before: unknown = Reflect.get(was, key)
      const after: unknown = Reflect.get(is, key)
      if (before === after || after === undefined) return []
      const patch = diff(before, after)
      return patch === undefined ? [] : [[key, patch]]
    }),
  )

/** The frame for `now`: the whole, when there was nothing before or the catalog changed; else what changed. */
export const frameOf = (before: EstateState | undefined, now: EstateState, owner: string): Frame => {
  if (before === undefined || before.catalog !== now.catalog || !sameNames(before, now))
    return { _tag: "Whole", owner, estate: toWire(now) }
  const environments = Object.fromEntries(
    Object.entries(now.environments).flatMap(([name, state]) => {
      const was = before.environments[name]
      const changed = was === undefined || was === state ? {} : patches(environmentParts, was, state)
      return Object.keys(changed).length === 0 ? [] : [[name, changed]]
    }),
  )
  return { _tag: "Changed", environments, parts: patches(estateParts, before, now) }
}

const patched = (
  allowed: ReadonlyArray<string>,
  before: object,
  parts: Readonly<Record<string, Patch>>,
): Record<string, unknown> | undefined =>
  Object.keys(parts).every((key) => allowed.includes(key))
    ? Object.fromEntries(Object.entries(parts).map(([key, patch]) => [key, applied(Reflect.get(before, key), patch)]))
    : undefined

/** What an entity owns of the estate, and so what of its whole a follower takes. */
export type Owned =
  | { readonly _tag: "All" }
  /** All but the environments, whose catalog's new ones start waiting, as `withCatalog` makes them. */
  | {
      readonly _tag: "Estate"
      readonly withCatalog: (estate: EstateState, catalog: EstateState["catalog"]) => EstateState
    }
  | { readonly _tag: "Environment"; readonly name: string }

const wholeFrom = (estate: EstateState, sent: EstateState, from: Owned): Result.Result<EstateState, string> => {
  switch (from._tag) {
    case "All":
      return Result.succeed(sent)
    case "Estate":
      return Result.succeed(from.withCatalog({ ...sent, environments: estate.environments }, sent.catalog))
    case "Environment": {
      const mine = sent.environments[from.name]
      if (mine === undefined || estate.environments[from.name] === undefined)
        return Result.fail(`${from.name} is not in this runner's catalog yet`)
      return Result.succeed({ ...estate, environments: { ...estate.environments, [from.name]: mine } })
    }
  }
}

/**
 * The owner's frame taken into a follower's state; or why it cannot be, when a patch does not apply to what the
 * follower has, so it follows again and is sent the whole.
 */
export const followed = (
  estate: EstateState,
  frame: Frame,
  /** What the frame's sender owns: the whole estate, the estate's own parts, or one environment. */
  from: Owned = { _tag: "All" },
): Result.Result<EstateState, string> => {
  if (frame._tag === "Whole") return wholeFrom(estate, fromWire(frame.estate), from)
  const environments: Record<string, EnvironmentState> = { ...estate.environments }
  for (const [name, parts] of Object.entries(frame.environments)) {
    const was = environments[name]
    const changed = was === undefined ? undefined : patched(environmentParts, was, parts)
    if (was === undefined || changed === undefined) return Result.fail(`${name} is not as the owner's was`)
    const decoded = decodeEnvironment({ ...was, ...changed })
    if (Result.isFailure(decoded)) return Result.fail(`${name} did not patch to an environment`)
    environments[name] = decoded.success
  }
  const changed = patched(estateParts, estate, frame.parts)
  const decoded = changed === undefined ? undefined : decodeParts(changed)
  if (decoded === undefined || Result.isFailure(decoded)) return Result.fail("the estate's parts did not patch")
  return Result.succeed({ ...estate, ...decoded.success, environments })
}
