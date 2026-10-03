/** A doctor's line: a part, whether it answered, and what it said; asked with the readers the server runs. */
import { Effect, type FileSystem } from "effect"
import type { Remote } from "./remote"
import type { Failure } from "./sources/run"

export interface Finding {
  readonly part: string
  readonly ok: boolean
  readonly says: string
}

export type Needs = Remote | FileSystem.FileSystem

export const amount = (value: number | null | undefined) =>
  value === null || value === undefined ? "no data" : String(Math.round(value * 100) / 100)

/** The part's line: what `read` found, put by `say`, or its failure in the tool's words. */
export const finding = <A>(part: string, read: Effect.Effect<A, Failure, Needs>, say: (found: A) => string) =>
  read.pipe(
    Effect.map((found): Finding => ({ part, ok: true, says: say(found) })),
    Effect.catch((failure) => Effect.succeed<Finding>({ part, ok: false, says: failure.message })),
  )
