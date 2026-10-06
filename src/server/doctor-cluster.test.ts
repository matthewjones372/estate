import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { clusterFinding } from "./doctor-cluster"
import type { Query } from "./notes"
import { SourceFailure } from "./sources/run"

/** A database answering the runners and the owner's beat from rows, or failing as a missing table does. */
const database =
  (runners: ReadonlyArray<string>, owner?: { readonly address: string; readonly ago: number }): Query =>
  (statement) =>
    statement.includes("estate_cluster_runners")
      ? Effect.succeed(runners.map((address) => ({ address })))
      : owner === undefined
        ? Effect.fail(new SourceFailure({ message: 'relation "estate_cluster_owner" does not exist' }))
        : Effect.succeed([{ address: owner.address, ago: String(owner.ago) }])

describe("the doctor's cluster line", () => {
  test("names every runner and the one reading the estate", () =>
    Effect.runPromise(
      clusterFinding(database(["10.0.4.12:34431", "10.0.7.3:34431"], { address: "10.0.4.12:34431", ago: 4.2 })),
    ).then((found) =>
      expect(found).toEqual({
        part: "cluster",
        ok: true,
        says: "2 runners (10.0.4.12:34431, 10.0.7.3:34431); estate read by 10.0.4.12:34431, beat 4 s ago",
      }),
    ))

  test("fails when no runner has beat within the shard lock's lifetime, or none has beat at all", () =>
    Effect.runPromise(
      Effect.all([
        clusterFinding(database(["10.0.4.12:34431"], { address: "10.0.4.12:34431", ago: 90 })),
        clusterFinding(database(["10.0.4.12:34431"])),
      ]),
    ).then((found) =>
      expect(found.map((each) => [each.ok, each.says])).toEqual([
        [false, "1 runner (10.0.4.12:34431); no runner reads the estate"],
        [false, "1 runner (10.0.4.12:34431); no runner reads the estate"],
      ]),
    ))

  test("fails with no runner, or no database", () =>
    Effect.runPromise(
      Effect.all([
        clusterFinding(database([])),
        clusterFinding(() => Effect.fail(new SourceFailure({ message: "the database: refused" }))),
      ]),
    ).then((found) =>
      expect(found.map((each) => [each.ok, each.says])).toEqual([
        [false, "no runner is registered"],
        [false, "the cluster's tables: the database: refused"],
      ]),
    ))
})
