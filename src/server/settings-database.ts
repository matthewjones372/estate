/**
 * `database:` in the settings: Estate's own database, holding its notes, impacts, alert history and Slack threads, and,
 * when clustered, its runners. Postgres or a DynamoDB table; without one, all of it is kept in memory.
 */
import { Schema } from "effect"
import type { Mistake } from "../shared/shape"
import { Secret } from "./secret"

const optional = Schema.optionalKey

export const Database = Schema.Struct({
  postgres: optional(Secret),
  dynamodb: optional(Schema.Struct({ table: Schema.String, region: Schema.String, endpoint: optional(Schema.String) })),
})

export const databaseMistakes = (database: typeof Database.Type | undefined): ReadonlyArray<Mistake> =>
  database?.postgres !== undefined && database.dynamodb !== undefined
    ? [{ at: "database", message: "is postgres or dynamodb, not both" }]
    : []

/** A database named under `notes:`, where it was once set, said as where it is set. */
export const misplacedDatabase = (parsed: unknown): ReadonlyArray<Mistake> => {
  const notes = typeof parsed === "object" && parsed !== null && "notes" in parsed ? parsed.notes : undefined
  if (typeof notes !== "object" || notes === null) return []
  return ["postgres", "dynamodb"].flatMap((kind) =>
    kind in notes ? [{ at: `notes.${kind}`, message: `Estate's database is set as database.${kind}` }] : [],
  )
}
