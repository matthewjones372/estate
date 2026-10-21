/** A Kafka store's cluster now, read from kafka_exporter's series by instant queries (spec 0057). */
import { Effect } from "effect"
import type { Store } from "../../shared/catalog"
import { clusterFrom, clusterQueries, type KafkaCluster, type Readings } from "../../shared/kafka-cluster"
import type { Remote } from "../remote"
import type { Ranges } from "./prometheus"
import { type Failure, SourceFailure } from "./run"

/**
 * The cluster, `now` in seconds. Brokers and leaders are needed and their failure fails the read; any other series
 * that fails is read as none, so a cluster without consumer groups, say, is still drawn.
 */
export const readCluster = (ranges: Ranges, store: Store, now: number): Effect.Effect<KafkaCluster, Failure, Remote> =>
  Effect.gen(function* () {
    const instant = ranges.instant
    if (instant === undefined)
      return yield* Effect.fail(new SourceFailure({ message: "this metrics source cannot read a query now" }))
    const queries = clusterQueries(store.selector)
    const names = Object.keys(queries) as ReadonlyArray<keyof Readings>
    const read = yield* Effect.forEach(
      names,
      (name) =>
        name === "seen" || name === "leader"
          ? instant(queries[name])
          : instant(queries[name]).pipe(Effect.orElseSucceed(() => [])),
      { concurrency: ranges.concurrency ?? 4 },
    )
    const readings = Object.fromEntries(names.map((name, index) => [name, read[index] ?? []])) as Readings
    if (readings.seen.length === 0)
      return yield* Effect.fail(
        new SourceFailure({
          message: `kafka_exporter publishes nothing for ${store.name}: no kafka_broker_info{${store.selector}}`,
        }),
      )
    return clusterFrom(readings, now)
  })
