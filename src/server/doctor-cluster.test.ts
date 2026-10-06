import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { clusterFinding } from "./doctor-cluster"
import type { Query } from "./notes"
import { SourceFailure } from "./sources/run"

/** A database answering the runners and the owners' beats from rows, or failing as a missing table does. */
const database =
  (
    runners: ReadonlyArray<string>,
    owners?: ReadonlyArray<{ readonly entity: string; readonly address: string; readonly ago: number }>,
  ): Query =>
  (statement) =>
    statement.includes("estate_cluster_runners")
      ? Effect.succeed(runners.map((address) => ({ address })))
      : owners === undefined
        ? Effect.fail(new SourceFailure({ message: 'relation "estate_cluster_owners" does not exist' }))
        : Effect.succeed(owners.map((owner) => ({ ...owner, ago: String(owner.ago) })))

const two = ["10.0.4.12:34431", "10.0.7.3:34431"]

describe("the doctor's cluster line", () => {
  test("names every runner, and who reads the estate and each environment", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const found = yield* clusterFinding(
          database(two, [
            { entity: "estate", address: "10.0.4.12:34431", ago: 2.2 },
            { entity: "env:production", address: "10.0.7.3:34431", ago: 4 },
          ]),
          ["production"],
        )
        expect(found).toEqual({
          part: "cluster",
          ok: true,
          says: "2 runners (10.0.4.12:34431, 10.0.7.3:34431); estate read by 10.0.4.12:34431, beat 2 s ago; production read by 10.0.7.3:34431, beat 4 s ago",
        })
      }),
    ))

  test("fails for an entity no one has beat for lately, or at all", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const stale = yield* clusterFinding(
          database(["10.0.4.12:34431"], [{ entity: "estate", address: "10.0.4.12:34431", ago: 90 }]),
          ["staging"],
        )
        expect([stale.ok, stale.says]).toEqual([
          false,
          "1 runner (10.0.4.12:34431); no runner reads estate; no runner reads staging",
        ])
        expect((yield* clusterFinding(database(["10.0.4.12:34431"]), [])).ok).toBe(false)
      }),
    ))

  test("fails with no runner, or no database", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const found = yield* Effect.all([
          clusterFinding(database([]), []),
          clusterFinding(() => Effect.fail(new SourceFailure({ message: "the database: refused" })), []),
        ])
        expect(found.map((each) => [each.ok, each.says])).toEqual([
          [false, "no runner is registered"],
          [false, "the cluster's tables: the database: refused"],
        ])
      }),
    ))
})
