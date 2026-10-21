import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Catalog, Store } from "../../shared/catalog"
import type { KafkaCluster } from "../../shared/kafka-cluster"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import { exporter } from "../fixture-kafka"
import { type Call, reply } from "../remote"
import type { Settings } from "../settings"

const bus: Store = { name: "bus", environments: ["staging"], engine: "kafka", selector: 'job="kafka"' }
const withBus: Catalog = { ...catalog, stores: [bus, { ...bus, name: "cache", engine: "redis" }] }
const metered: Settings = {
  ...settings({ anonymous: { name: "visitor", role: "viewer" } }),
  sources: { staging: { prometheus: { url: "http://prometheus" } } },
}

const asked = (path: string, answer?: (call: Call) => ReturnType<typeof reply> | undefined, from = metered) =>
  Effect.flatMap(serverFor(from, estate({ catalog: withBus }), answer), (server) =>
    ask(server, new Request(`http://estate${path}`)),
  )

describe("a Kafka store's cluster", () => {
  test("is its brokers, a gone one marked, and its partitions with leader, replicas in sync and preferred", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answered = yield* asked("/api/store-cluster?env=staging&store=bus", exporter(Date.now() / 1000))
        const cluster = answered.json() as KafkaCluster
        expect(cluster.brokers.map((broker) => [broker.id, broker.leads, broker.gone])).toEqual([
          ["1", 1, undefined],
          ["2", 2, undefined],
          ["3", 0, 600],
        ])
        expect(cluster.topics.map((topic) => [topic.name, topic.rate])).toEqual([
          ["orders", 240],
          ["payments", 35],
        ])
        expect(cluster.topics[0]?.partitions).toEqual([
          { id: 0, leader: "1", replicas: 3, inSync: 2, preferred: true, oldest: 100, newest: 1_882_340 },
          { id: 1, leader: "2", replicas: 3, inSync: 3, preferred: false, oldest: null, newest: null },
          { id: 2, leader: null, replicas: 3, inSync: 2, preferred: true, oldest: null, newest: null },
        ])
        expect(cluster.groups).toEqual([
          {
            name: "orders-projector",
            members: 3,
            lag: 12_010,
            rate: 230,
            growing: 40,
            partitions: [
              { topic: "orders", partition: 0, offset: 1_870_340, lag: 12_000 },
              { topic: "orders", partition: 1, offset: null, lag: 10 },
            ],
          },
        ])
      }),
    ))

  test("is still drawn when its consumer groups' series fail, with no groups", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answer = exporter(Date.now() / 1000)
        const answered = yield* asked("/api/store-cluster?env=staging&store=bus", (call) =>
          new URL(call.url).searchParams.get("query")?.startsWith("kafka_consumergroup")
            ? reply({ error: "down" }, 503)
            : answer(call),
        )
        const cluster = answered.json() as KafkaCluster
        expect([answered.status, cluster.brokers.length, cluster.groups]).toEqual([200, 3, []])
      }),
    ))

  test("says a group's lag is not known when its lag series fails, keeping its offsets", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answer = exporter(Date.now() / 1000)
        const answered = yield* asked("/api/store-cluster?env=staging&store=bus", (call) =>
          new URL(call.url).searchParams.get("query")?.startsWith("kafka_consumergroup_lag")
            ? reply({ error: "down" }, 503)
            : answer(call),
        )
        const group = (answered.json() as KafkaCluster).groups[0]
        expect(group?.lag).toBeNull()
        expect(group?.partitions).toEqual([{ topic: "orders", partition: 0, offset: 1_870_340, lag: null }])
      }),
    ))

  test("is not there for a store whose cluster is not drawn, one with no series, or without metrics, each saying why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const redis = yield* asked("/api/store-cluster?env=staging&store=cache", exporter(Date.now() / 1000))
        expect([redis.status, redis.json()]).toEqual([
          404,
          { message: "cache is a redis store, whose cluster Estate does not draw" },
        ])
        const silent = yield* asked("/api/store-cluster?env=staging&store=bus", () => reply({ data: { result: [] } }))
        expect([silent.status, silent.json()]).toEqual([
          404,
          { message: 'kafka_exporter publishes nothing for bus: no kafka_broker_info{job="kafka"}' },
        ])
        const bare = yield* asked("/api/store-cluster?env=staging&store=bus", undefined, {
          ...metered,
          sources: { staging: {} },
        })
        expect([bare.status, bare.json()]).toEqual([404, { message: "staging has no metrics to read" }])
      }),
    ))
})
