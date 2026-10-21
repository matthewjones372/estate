import { describe, expect, test } from "bun:test"
import { Effect, Layer, SubscriptionRef } from "effect"
import type { Catalog, DiscoverRule } from "../../shared/catalog"
import { catalog, estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, reply, stubRemote } from "../remote"
import type { Settings } from "../settings"
import { Estate, estateLayer } from "../state"
import { discoverOnce, makeCatalogs } from "./run"

const rule: DiscoverRule = {
  kafka: { by: ["namespace", "strimzi_io_cluster"], selector: 'job="kafka-exporter"' },
  store: {
    name: "{label:strimzi_io_cluster}",
    category: "Data",
    links: { dashboard: "https://grafana.{env}.example/d/kafka?var-cluster={label:strimzi_io_cluster}" },
  },
}

const written: Catalog = {
  ...catalog,
  stores: [{ name: "audit", environments: ["production"], engine: "kafka", selector: 'job="audit"' }],
  discover: [rule],
}

const metered: Settings = {
  ...settings(),
  sources: {
    staging: { prometheus: { url: "http://staging" } },
    production: { prometheus: { url: "http://production" } },
  },
}

const series = (namespace: string, cluster: string) => ({
  metric: { namespace, strimzi_io_cluster: cluster },
  value: [0, "3"],
})

/** Two Prometheuses: bus in both, and in production audit, which is written, and orders, a service's name. */
const prometheuses =
  (queries: Array<string>, down = new Set<string>()) =>
  (call: Call) => {
    const url = new URL(call.url)
    queries.push(`${url.host} ${url.searchParams.get("query")}`)
    if (down.has(url.host)) return reply({ message: "down" }, 503)
    return reply({
      data: {
        result: [
          series("data", "bus"),
          ...(url.host === "production" ? [series("data", "audit"), series("data", "orders")] : []),
        ],
      },
    })
  }

/** The catalog shown after a round of discovery for each set of Prometheuses that are down. */
const shownAfter = (from: Catalog, rounds: ReadonlyArray<ReadonlyArray<string>>, queries: Array<string> = []) => {
  const down = new Set<string>()
  return Effect.gen(function* () {
    const catalogs = yield* makeCatalogs(from)
    for (const round of rounds) {
      down.clear()
      for (const host of round) down.add(host)
      yield* discoverOnce(catalogs, metered)
    }
    return (yield* SubscriptionRef.get(yield* Estate)).catalog
  }).pipe(
    Effect.provide(estateLayer(estate({ catalog: from }))),
    Effect.provide(Layer.merge(stubRemote(prometheuses(queries, down)), platform)),
  )
}

describe("discovered Kafka clusters", () => {
  test("are each cluster kafka_exporter is scraped for, as one store in every environment it is in", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const queries: Array<string> = []
        const shown = yield* shownAfter(written, [[]], queries)
        expect(queries).toContain(
          'staging count by (namespace,strimzi_io_cluster) (kafka_brokers{job="kafka-exporter"})',
        )
        expect(shown.stores?.map((store) => store.name)).toEqual(["audit", "bus"])
        expect(shown.stores?.[1]).toEqual({
          name: "bus",
          category: "Data",
          links: { dashboard: "https://grafana.{env}.example/d/kafka?var-cluster=bus" },
          environments: ["staging", "production"],
          engine: "kafka",
          selector: 'job="kafka-exporter",namespace="data",strimzi_io_cluster="bus"',
          discovered: { from: "prometheus" },
        })
        // The written audit wins whole, and orders, a service's name, is left out.
        expect(shown.stores?.[0]?.discovered).toBeUndefined()
      }),
    ))

  test("are kept when a Prometheus stops answering", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const shown = yield* shownAfter(written, [[], ["production"]])
        expect(shown.stores?.map((store) => [store.name, store.environments])).toEqual([
          ["audit", ["production"]],
          ["bus", ["staging", "production"]],
        ])
      }),
    ))

  test("are named by their labels' values when the rule names no store", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bare: Catalog = { ...written, discover: [{ kafka: { by: ["namespace", "strimzi_io_cluster"] } }] }
        const shown = yield* shownAfter(bare, [[]])
        expect(shown.stores?.map((store) => [store.name, store.selector])).toEqual([
          ["audit", 'job="audit"'],
          ["data-bus", 'namespace="data",strimzi_io_cluster="bus"'],
          ["data-audit", 'namespace="data",strimzi_io_cluster="audit"'],
          ["data-orders", 'namespace="data",strimzi_io_cluster="orders"'],
        ])
      }),
    ))
})
