import { describe, expect, test } from "bun:test"
import { Effect, Layer, Ref, Result, SubscriptionRef } from "effect"
import type { Catalog, DiscoverRule } from "../../shared/catalog"
import { checkCatalog } from "../../shared/check"
import { kafkaFinding } from "../doctor-discover"
import { catalog, estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, reply, stubRemote } from "../remote"
import type { Settings } from "../settings"
import { prometheusRanges } from "../sources/prometheus"
import { Estate, estateLayer } from "../state"
import { catalogView } from "../views/catalog"
import { shown as shownFrom } from "./merge"
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
  (queries: Array<string>, down = new Set<string>(), stagingNamespace = "data") =>
  (call: Call) => {
    const url = new URL(call.url)
    queries.push(`${url.host} ${url.searchParams.get("query")}`)
    if (down.has(url.host)) return reply({ message: "down" }, 503)
    return reply({
      data: {
        result: [
          series(url.host === "staging" ? stagingNamespace : "data", "bus"),
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

  test("are offered to the page as YAML that is a store entry, marked only by where they were found", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const shown = yield* shownAfter(written, [[]])
        const stores = catalogView(shown, "staging").stores ?? []
        const bus = stores.find((store) => store.name === "bus")
        expect(bus?.discovered?.from).toBe("prometheus")
        const pasted = Bun.YAML.parse(`stores:\n${(bus?.discovered?.yaml ?? "").replace(/^/gm, "  ")}`)
        const checked = checkCatalog({ environments: catalog.environments, services: [], ...(pasted as object) })
        expect(Result.isSuccess(checked) && checked.success.stores?.[0]?.selector).toBe(
          'job="kafka-exporter",namespace="data",strimzi_io_cluster="bus"',
        )
        expect(catalogView(shown, "production").stores?.[0]?.discovered).toBeUndefined()
      }),
    ))
})

describe("a found name that is taken", () => {
  test("is left out where a cluster of that name has other labels, and said", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const [shown, said] = yield* Effect.gen(function* () {
          const catalogs = yield* makeCatalogs(written)
          yield* discoverOnce(catalogs, metered)
          return [(yield* SubscriptionRef.get(yield* Estate)).catalog, yield* Ref.get(catalogs.said)] as const
        }).pipe(
          Effect.provide(estateLayer(estate({ catalog: written }))),
          Effect.provide(Layer.merge(stubRemote(prometheuses([], new Set(), "data-staging")), platform)),
        )
        const bus = shown.stores?.find((store) => store.name === "bus")
        expect(bus?.environments).toEqual(["staging"])
        expect(bus?.selector).toContain('namespace="data-staging"')
        expect(said).toContain(
          'production bus: found with other labels in staging (job="kafka-exporter",namespace="data-staging",strimzi_io_cluster="bus"); name the store by a label that tells them apart',
        )
      }),
    ))

  test("by a service or a store is left to the written entry, then to the found service", () => {
    const store = { name: "bus", environments: ["production"], engine: "kafka" as const, selector: "a" }
    const service = { name: "bus", environments: ["production"] }
    const withStore: Catalog = { ...catalog, stores: [{ ...store, name: "ledger" }] }
    const { catalog: shown, clashes } = shownFrom(
      withStore,
      [service, { name: "ledger", environments: ["production"] }],
      [{ ...store, discovered: { from: "prometheus" } }],
    )
    expect(shown.services.filter((each) => ["bus", "ledger"].includes(each.name)).map((each) => each.name)).toEqual([
      "bus",
    ])
    expect(shown.stores?.map((each) => each.name)).toEqual(["ledger"])
    expect(clashes).toEqual(["ledger: a written store has this name", "bus: a found service has this name"])
  })
})

describe("the doctor's Kafka discover line", () => {
  const asked = (host: string, answer = prometheuses([]), from: Catalog = written) =>
    kafkaFinding(prometheusRanges({ url: `http://${host}`, headers: {} }), from, host).pipe(
      Effect.provide(Layer.merge(stubRemote(answer), platform)),
    )

  test("names the clusters found, those written over, and those left out with why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* asked("production")).toEqual({
          part: "discover",
          ok: true,
          says: 'Kafka: 2 stores found, 1 written over (audit), 1 left out (orders: "orders" is also a service\'s name)',
        })
      }),
    ))

  test("fails in Prometheus's words, and says nothing without a rule", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect(yield* asked("production", prometheuses([], new Set(["production"])))).toMatchObject({
          part: "discover",
          ok: false,
        })
        expect(yield* asked("production", prometheuses([]), catalog)).toBeUndefined()
      }),
    ))
})
