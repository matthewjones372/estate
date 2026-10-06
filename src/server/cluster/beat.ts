/**
 * The owners' beats: the runner reading each of the estate's entities writes its address and the time, every few
 * seconds, to a row of its own beside Effect's runner table, so `estate doctor` can name who reads what and say how
 * lately each was heard from.
 */
import { Effect } from "effect"
import { ShardingConfig } from "effect/cluster/ShardingConfig"
import { SqlClient } from "effect/sql/SqlClient"
import { forEver } from "../schedule"
import { selfOf } from "./follow"

const ownersTable = "estate_cluster_owners"

/** Writes `entity`'s beat for as long as this runner reads it; a beat that fails is logged, and the next tried. */
export const beating = (entity: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient
    const address = selfOf(yield* ShardingConfig)
    const beat = sql
      .unsafe(
        `INSERT INTO ${ownersTable} (entity, address, beat) VALUES ($1, $2, now())
         ON CONFLICT (entity) DO UPDATE SET address = excluded.address, beat = excluded.beat`,
        [entity, address],
      )
      .pipe(Effect.catch((error) => Effect.logWarning(`${entity}'s beat could not be written: ${error.message}`)))
    yield* sql
      .unsafe(
        `CREATE TABLE IF NOT EXISTS ${ownersTable} (entity TEXT PRIMARY KEY, address TEXT NOT NULL, beat TIMESTAMPTZ NOT NULL)`,
      )
      .pipe(Effect.retry({ times: 3 }), Effect.orDie)
    return yield* forEver(beat, "5 seconds")
  })
