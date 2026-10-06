/**
 * How a part of the estate changed, as little as says it: an object by the keys that changed, a series of numbers by
 * the points it gained when it only moved along, and anything else whole. Most of what a read changes is each
 * series moving along a point, so a frame carries that rather than every series again.
 */
import { Schema } from "effect"

export type Patch =
  | { readonly set: unknown }
  | { readonly keys: Readonly<Record<string, Patch>>; readonly drop?: ReadonlyArray<string> }
  | { readonly shift: number; readonly tail: ReadonlyArray<number | null> }

export const Patch: Schema.Codec<Patch> = Schema.Union([
  Schema.Struct({ set: Schema.Unknown }),
  Schema.Struct({
    keys: Schema.Record(
      Schema.String,
      Schema.suspend((): Schema.Codec<Patch> => Patch),
    ),
    drop: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({ shift: Schema.Number, tail: Schema.Array(Schema.NullOr(Schema.Number)) }),
])

type Json = unknown

const isObject = (value: Json): value is Readonly<Record<string, Json>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isSeries = (value: Json): value is ReadonlyArray<number | null> =>
  Array.isArray(value) && value.every((each) => each === null || typeof each === "number")

const same = (a: Json, b: Json): boolean => {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((each, index) => same(each, b[index]))
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && same(a[key], b[key]))
  }
  return false
}

/** As the page's stream finds it: at most this many points fall off the front, and this many are new or revised. */
const most = 4

const shiftOf = (before: ReadonlyArray<number | null>, after: ReadonlyArray<number | null>) => {
  const length = after.length
  if (before.length !== length) return undefined
  for (let tail = 0; tail <= Math.min(most, length); tail++)
    for (let shift = 0; shift <= tail; shift++)
      if (after.slice(0, length - tail).every((point, index) => point === before[index + shift]))
        return { shift, tail: after.slice(length - tail) }
  return undefined
}

/** How `before` became `after`; none when they are the same. */
export const diff = (before: Json, after: Json): Patch | undefined => {
  if (same(before, after)) return undefined
  if (isSeries(before) && isSeries(after)) return shiftOf(before, after) ?? { set: after }
  if (isObject(before) && isObject(after)) {
    const keys = Object.fromEntries(
      Object.keys(after).flatMap((key) => {
        const patch = key in before ? diff(before[key], after[key]) : { set: after[key] }
        return patch === undefined ? [] : [[key, patch]]
      }),
    )
    const drop = Object.keys(before).filter((key) => !(key in after))
    return drop.length === 0 ? { keys } : { keys, drop }
  }
  return { set: after }
}

/** `before` with `patch` applied; what comes out is checked by the part's own schema, not here. */
export const applied = (before: Json, patch: Patch): Json => {
  if ("set" in patch) return patch.set
  if ("shift" in patch) {
    if (!isSeries(before)) return undefined
    const kept = before.length - patch.tail.length
    return [...before.slice(patch.shift, patch.shift + kept), ...patch.tail]
  }
  const base = isObject(before) ? before : {}
  const dropped = new Set(patch.drop ?? [])
  // Keys stay in the order they had, so the state renders to the same text as the owner's.
  return Object.fromEntries([
    ...Object.entries(base)
      .filter(([key]) => !dropped.has(key))
      .map(([key, value]) => {
        const each = patch.keys[key]
        return [key, each === undefined ? value : applied(value, each)] as const
      }),
    ...Object.entries(patch.keys)
      .filter(([key]) => !(key in base))
      .map(([key, each]) => [key, applied(undefined, each)] as const),
  ])
}
