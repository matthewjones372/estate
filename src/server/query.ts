/** How the notes reach Postgres, or anything that answers SQL like it. */
import type { Effect } from "effect"
import type { Failure } from "./sources/run"

/** The little of a SQL client the notes need: a statement with its parameters, and the rows it returns. */
export type Query = (
  statement: string,
  parameters: ReadonlyArray<unknown>,
) => Effect.Effect<ReadonlyArray<Record<string, unknown>>, Failure>
