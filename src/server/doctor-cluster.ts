/**
 * The doctor's `cluster` line: the runners registered in Estate's Postgres, and who reads the estate and each of its
 * environments, by their owners' beats, with how long since each beat. Fails with no runner, or with an entity no one
 * has beat for within the shard lock's lifetime.
 */
import { Effect } from "effect"
import type { Finding } from "./doctor-finding"
import type { Query } from "./notes"

/** Effect's shard lock lasts this long; an owner silent for longer has lost it. */
const lockSeconds = 35

const runnersSql = "SELECT address FROM estate_cluster_runners WHERE healthy ORDER BY address"
const ownersSql = "SELECT entity, address, EXTRACT(EPOCH FROM now() - beat) AS ago FROM estate_cluster_owners"

const plural = (count: number) => `${count} runner${count === 1 ? "" : "s"}`

/** The line, for the estate and the environments the catalog names. */
export const clusterFinding = (query: Query, environments: ReadonlyArray<string>): Effect.Effect<Finding> =>
  Effect.all({
    runners: query(runnersSql, []),
    // No beat table yet is no runner having read anything yet.
    owners: query(ownersSql, []).pipe(Effect.orElseSucceed(() => [])),
  }).pipe(
    Effect.map(({ runners, owners }): Finding => {
      const addresses = runners.map((row) => String(row["address"]))
      if (addresses.length === 0) return { part: "cluster", ok: false, says: "no runner is registered" }
      const beats = new Map(
        owners.map((row) => [
          String(row["entity"]),
          { by: String(row["address"]), ago: Math.round(Number(row["ago"])) },
        ]),
      )
      const entities = [["estate", "estate"], ...environments.map((name) => [`env:${name}`, name])] as const
      const said = entities.map(([entity, name]) => {
        const beat = beats.get(entity)
        return beat === undefined || beat.ago > lockSeconds
          ? { ok: false, text: `no runner reads ${name}` }
          : { ok: true, text: `${name} read by ${beat.by}, beat ${beat.ago} s ago` }
      })
      return {
        part: "cluster",
        ok: said.every((each) => each.ok),
        says: `${plural(addresses.length)} (${addresses.join(", ")}); ${said.map((each) => each.text).join("; ")}`,
      }
    }),
    Effect.catch((error) =>
      Effect.succeed<Finding>({ part: "cluster", ok: false, says: `the cluster's tables: ${error.message}` }),
    ),
  )
