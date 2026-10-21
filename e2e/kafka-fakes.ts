/**
 * kafka_exporter, as e2e/tools.ts answers Prometheus's instant queries for it: one cluster, bus, of four brokers, the
 * fourth gone; topics from thousands of messages a second to a few, partitions short of replicas, off their preferred
 * leader and one with none; and three consumer groups, one falling behind.
 */
const at = () => Date.now() / 1000

const series = (metric: Record<string, string>, value: number) => ({ metric, value: [at(), String(value)] })

interface Topic {
  readonly name: string
  readonly rate: number
  readonly partitions: number
  readonly replicas: number
  readonly shift: number
}

const topics: ReadonlyArray<Topic> = [
  { name: "orders", rate: 2400, partitions: 6, replicas: 3, shift: 0 },
  { name: "payments", rate: 240, partitions: 4, replicas: 3, shift: 1 },
  { name: "inventory", rate: 12, partitions: 3, replicas: 3, shift: 2 },
  { name: "audit", rate: 0.4, partitions: 2, replicas: 1, shift: 3 },
]

const gone = 3

/** Each partition's replicas, its first the preferred leader; its leader the first replica on a broker still up. */
const partitions = topics.flatMap((topic) =>
  Array.from({ length: topic.partitions }, (_, id) => {
    const replicas = Array.from({ length: topic.replicas }, (_, index) => (id + topic.shift + index) % 4)
    const alive = replicas.filter((broker) => broker !== gone)
    return { topic: topic.name, id, replicas, leader: alive[0] ?? -1, inSync: alive.length }
  }),
)

const each = (value: (partition: (typeof partitions)[number]) => number) =>
  partitions.map((partition) => series({ topic: partition.topic, partition: String(partition.id) }, value(partition)))

const groups = [
  { name: "orders-projector", members: 3, topic: "orders", rate: 2300, lags: [12_000, 140, 90, 110, 40, 30] },
  { name: "billing", members: 2, topic: "payments", rate: 238, lags: [30, 22, 41, 18] },
  { name: "search-indexer", members: 1, topic: "inventory", rate: 12, lags: [0, 2, 0] },
]

const perGroup = (value: (group: (typeof groups)[number]) => number) =>
  groups.map((group) => series({ consumergroup: group.name }, value(group)))

const perGroupPartition = (value: (lag: number, newest: number) => number) =>
  groups.flatMap((group) =>
    group.lags.map((lag, partition) =>
      series({ consumergroup: group.name, topic: group.topic, partition: String(partition) }, value(lag, 1_882_340)),
    ),
  )

const answers: ReadonlyArray<readonly [string, () => ReadonlyArray<ReturnType<typeof series>>]> = [
  ["count by", () => [series({ namespace: "data", strimzi_io_cluster: "bus" }, 4)]],
  [
    "max_over_time(timestamp(kafka_broker_info",
    () =>
      [0, 1, 2, 3].map((id) =>
        series({ id: String(id), address: `bus-kafka-${id}:9092` }, at() - (id === gone ? 540 : 15)),
      ),
  ],
  ["kafka_topic_partition_leader_is_preferred", () => each((p) => (p.leader === p.replicas[0] ? 1 : 0))],
  ["kafka_topic_partition_leader", () => each((p) => p.leader)],
  ["kafka_topic_partition_replicas", () => each((p) => p.replicas.length)],
  ["kafka_topic_partition_in_sync_replica", () => each((p) => p.inSync)],
  ["kafka_topic_partition_oldest_offset", () => each((p) => 1_200_000 + p.id * 9_311)],
  ["sum by (topic) (rate(", () => topics.map((topic) => series({ topic: topic.name }, topic.rate))],
  ["kafka_topic_partition_current_offset", () => each((p) => 1_882_340 + p.id * 7_203)],
  ["kafka_consumergroup_members", () => perGroup((group) => group.members)],
  ["sum by (consumergroup) (rate(", () => perGroup((group) => group.rate)],
  ["deriv(", () => perGroup((group) => (group.name === "orders-projector" ? 40 : 0))],
  ["kafka_consumergroup_lag", () => perGroupPartition((lag) => lag)],
  ["kafka_consumergroup_current_offset", () => perGroupPartition((lag, newest) => newest - lag)],
]

/** The series a query asks of kafka_exporter, or undefined for a query that is not about Kafka. */
export const kafkaAnswer = (query: string) =>
  query.includes("kafka_") ? (answers.find(([start]) => query.startsWith(start))?.[1]() ?? []) : undefined
