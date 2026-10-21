/** A Postgres or cnpg store's cluster now, read from its exporter's series by instant queries (spec 0060). */
import { Effect } from "effect"
import type { Store } from "../../shared/catalog"
import {
  type DatabaseReadings,
  databaseFrom,
  databaseQueries,
  type PostgresCluster,
} from "../../shared/postgres-cluster"
import { rulesOf } from "../../shared/stores"
import type { Remote } from "../remote"
import type { Ranges } from "./prometheus"
import { type Failure, SourceFailure } from "./run"

/** The store's lag and connections thresholds, its own where it sets them. */
const limitsOf = (store: Store): PostgresCluster["limits"] => {
  const threshold = (key: string, otherwise: number) =>
    store.attention?.[key] ?? rulesOf(store).find((rule) => rule.key === key)?.threshold ?? otherwise
  return { lag: threshold("lag", 30), connections: threshold("connections", 80) }
}

/**
 * The cluster, `now` in seconds. The instances are needed and their failure fails the read; any other series that
 * fails is read as none, so a cluster whose exporter lacks the slots collector, say, is still drawn.
 */
export const readDatabase = (
  ranges: Ranges,
  store: Store & { readonly engine: "postgres" | "cnpg" },
  now: number,
): Effect.Effect<PostgresCluster, Failure, Remote> =>
  Effect.gen(function* () {
    const instant = ranges.instant
    if (instant === undefined)
      return yield* Effect.fail(new SourceFailure({ message: "this metrics source cannot read a query now" }))
    const queries = databaseQueries(store.engine, store.selector)
    const names = Object.keys(queries) as ReadonlyArray<keyof DatabaseReadings>
    const read = yield* Effect.forEach(
      names,
      (name) =>
        queries[name] === ""
          ? Effect.succeed([])
          : name === "seen"
            ? instant(queries[name])
            : instant(queries[name]).pipe(Effect.orElseSucceed(() => [])),
      { concurrency: ranges.concurrency ?? 4 },
    )
    const readings = Object.fromEntries(names.map((name, index) => [name, read[index] ?? []])) as DatabaseReadings
    if (readings.seen.length === 0)
      return yield* Effect.fail(
        new SourceFailure({ message: `the exporter publishes nothing for ${store.name}: no ${queries.seen}` }),
      )
    return databaseFrom(store.engine, readings, limitsOf(store), now)
  })
