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

/**
 * The owner's frame taken into a follower's state; or why it cannot be, when a patch does not apply to what the
 * follower has, so it follows again and is sent the whole.
 */
export const followed = (estate: EstateState, frame: Frame): Result.Result<EstateState, string> => {
  if (frame._tag === "Whole") return Result.succeed(fromWire(frame.estate))
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
