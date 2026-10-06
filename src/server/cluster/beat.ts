/**
 * The owner's beat: the runner reading the estate writes its address and the time, every few seconds, to a one-row
 * table beside Effect's runner table, so `estate doctor` can name it and say how lately it was heard from.
 */
import { Effect } from "effect"
import { ShardingConfig } from "effect/cluster/ShardingConfig"
import { SqlClient } from "effect/sql/SqlClient"
import { forEver } from "../schedule"

const ownerTable = "estate_cluster_owner"

/** Writes the beat for as long as this runner reads the estate; a beat that fails is logged, and the next tried. */
export const beating = Effect.gen(function* () {
  const sql = yield* SqlClient
  const config = yield* ShardingConfig
  const address =
    config.runnerAddress._tag === "Some" ? `${config.runnerAddress.value.host}:${config.runnerAddress.value.port}` : ""
  const beat = sql
    .unsafe(
      `INSERT INTO ${ownerTable} (id, address, beat) VALUES (1, $1, now())
       ON CONFLICT (id) DO UPDATE SET address = excluded.address, beat = excluded.beat`,
      [address],
    )
    .pipe(Effect.catch((error) => Effect.logWarning(`the owner's beat could not be written: ${error.message}`)))
  yield* sql
    .unsafe(
      `CREATE TABLE IF NOT EXISTS ${ownerTable} (id INT PRIMARY KEY, address TEXT NOT NULL, beat TIMESTAMPTZ NOT NULL)`,
    )
    .pipe(Effect.retry({ times: 3 }), Effect.orDie)
  return yield* forEver(beat, "5 seconds")
})
