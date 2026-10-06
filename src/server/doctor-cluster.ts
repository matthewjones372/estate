/**
 * The doctor's `cluster` line: the runners registered in Estate's Postgres, and the one the owner's beat names, with
 * how long since it beat. Fails with no runner, or with no beat in the shard lock's lifetime, when no runner reads.
 */
import { Effect } from "effect"
import type { Finding } from "./doctor-finding"
import type { Query } from "./notes"

/** Effect's shard lock lasts this long; an owner silent for longer has lost it. */
const lockSeconds = 35

const runnersSql = "SELECT address FROM estate_cluster_runners WHERE healthy ORDER BY address"
const ownerSql = "SELECT address, EXTRACT(EPOCH FROM now() - beat) AS ago FROM estate_cluster_owner WHERE id = 1"

const plural = (count: number) => `${count} runner${count === 1 ? "" : "s"}`

export const clusterFinding = (query: Query): Effect.Effect<Finding> =>
  Effect.all({
    runners: query(runnersSql, []),
    // No beat table yet is no runner having read the estate yet.
    owner: query(ownerSql, []).pipe(Effect.orElseSucceed(() => [])),
  }).pipe(
    Effect.map(({ runners, owner }): Finding => {
      const addresses = runners.map((row) => String(row["address"]))
      const listed = `${plural(addresses.length)} (${addresses.join(", ")})`
      const reader = owner[0]
      const ago = Math.round(Number(reader?.["ago"] ?? Number.POSITIVE_INFINITY))
      if (addresses.length === 0) return { part: "cluster", ok: false, says: "no runner is registered" }
      if (reader === undefined || ago > lockSeconds)
        return { part: "cluster", ok: false, says: `${listed}; no runner reads the estate` }
      return {
        part: "cluster",
        ok: true,
        says: `${listed}; estate read by ${String(reader["address"])}, beat ${ago} s ago`,
      }
    }),
    Effect.catch((error) =>
      Effect.succeed<Finding>({ part: "cluster", ok: false, says: `the cluster's tables: ${error.message}` }),
    ),
  )
