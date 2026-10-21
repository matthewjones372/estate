import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Catalog, Store } from "../../shared/catalog"
import type { KafkaCluster } from "../../shared/kafka-cluster"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import { type Call, reply } from "../remote"
import type { Settings } from "../settings"

const bus: Store = { name: "bus", environments: ["staging"], engine: "kafka", selector: 'job="kafka"' }
const withBus: Catalog = { ...catalog, stores: [bus, { ...bus, name: "orders-db", engine: "cnpg" }] }
const metered: Settings = {
  ...settings({ anonymous: { name: "visitor", role: "viewer" } }),
  sources: { staging: { prometheus: { url: "http://prometheus" } } },
}

const series = (labels: Record<string, string>, value: number) => ({ metric: labels, value: [0, String(value)] })
const partition = (topic: string, id: number, value: number) => series({ topic, partition: String(id) }, value)

/** kafka_exporter's series for three brokers, the third gone ten minutes; orders in trouble, payments well. */
const exporter = (now: number) => (call: Call) => {
  const url = new URL(call.url)
  if (url.pathname !== "/api/v1/query") return undefined
  const query = url.searchParams.get("query") ?? ""
  if (!query.includes('job="kafka"')) return reply({ data: { result: [] } })
  const answers: ReadonlyArray<readonly [string, ReadonlyArray<ReturnType<typeof series>>]> = [
    [
      "max_over_time(timestamp(kafka_broker_info",
      [
        series({ id: "1", address: "kafka-0:9092" }, now - 20),
        series({ id: "2", address: "kafka-1:9092" }, now - 20),
        series({ id: "3", address: "kafka-2:9092" }, now - 600),
      ],
    ],
    [
      "kafka_topic_partition_leader_is_preferred",
      [partition("orders", 0, 1), partition("orders", 1, 0), partition("orders", 2, 1), partition("payments", 0, 1)],
    ],
    [
      "kafka_topic_partition_leader",
      [partition("orders", 0, 1), partition("orders", 1, 2), partition("orders", 2, -1), partition("payments", 0, 2)],
    ],
    [
      "kafka_topic_partition_replicas",
      [0, 1, 2].map((id) => partition("orders", id, 3)).concat(partition("payments", 0, 3)),
    ],
    [
      "kafka_topic_partition_in_sync_replica",
      [partition("orders", 0, 2), partition("orders", 1, 3), partition("orders", 2, 2), partition("payments", 0, 3)],
    ],
    ["kafka_topic_partition_oldest_offset", [partition("orders", 0, 100)]],
    ["sum by (topic) (rate(", [series({ topic: "orders" }, 240), series({ topic: "payments" }, 35)]],
    ["kafka_topic_partition_current_offset", [partition("orders", 0, 1_882_340), partition("payments", 0, 90)]],
    ["kafka_consumergroup_members", [series({ consumergroup: "orders-projector" }, 3)]],
    ["sum by (consumergroup) (rate(", [series({ consumergroup: "orders-projector" }, 230)]],
    ["deriv(", [series({ consumergroup: "orders-projector" }, 40)]],
    [
      "kafka_consumergroup_lag",
      [
        series({ consumergroup: "orders-projector", topic: "orders", partition: "0" }, 12_000),
        series({ consumergroup: "orders-projector", topic: "orders", partition: "1" }, 10),
      ],
    ],
    [
      "kafka_consumergroup_current_offset",
      [series({ consumergroup: "orders-projector", topic: "orders", partition: "0" }, 1_870_340)],
    ],
  ]
  return reply({ data: { result: answers.find(([start]) => query.startsWith(start))?.[1] ?? [] } })
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

  test("is not there for a store that is not Kafka, one with no series, or without metrics, each saying why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cnpg = yield* asked("/api/store-cluster?env=staging&store=orders-db", exporter(Date.now() / 1000))
        expect([cnpg.status, cnpg.json()]).toEqual([404, { message: "orders-db is not a Kafka store" }])
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
