/**
 * kafka_exporter, as e2e/tools.ts answers Prometheus's instant queries for it: one cluster, bus, of three brokers,
 * the third gone; orders with a partition short of a replica and one off its preferred leader; one consumer group.
 */
const at = () => Date.now() / 1000

const series = (metric: Record<string, string>, value: number) => ({ metric, value: [at(), String(value)] })
const partitions = (values: Readonly<Record<string, number>>) =>
  Object.entries(values).map(([key, value]) => {
    const [topic = "", partition = ""] = key.split("/")
    return series({ topic, partition }, value)
  })

const answers: ReadonlyArray<readonly [string, () => ReadonlyArray<ReturnType<typeof series>>]> = [
  ["count by", () => [series({ namespace: "data", strimzi_io_cluster: "bus" }, 3)]],
  [
    "max_over_time(timestamp(kafka_broker_info",
    () => [
      series({ id: "0", address: "bus-kafka-0:9092" }, at() - 15),
      series({ id: "1", address: "bus-kafka-1:9092" }, at() - 15),
      series({ id: "2", address: "bus-kafka-2:9092" }, at() - 540),
    ],
  ],
  [
    "kafka_topic_partition_leader_is_preferred",
    () => partitions({ "orders/0": 1, "orders/1": 0, "orders/2": 1, "payments/0": 1, "payments/1": 1 }),
  ],
  [
    "kafka_topic_partition_leader",
    () => partitions({ "orders/0": 0, "orders/1": 0, "orders/2": 1, "payments/0": 1, "payments/1": 0 }),
  ],
  [
    "kafka_topic_partition_replicas",
    () => partitions({ "orders/0": 3, "orders/1": 3, "orders/2": 3, "payments/0": 3, "payments/1": 3 }),
  ],
  [
    "kafka_topic_partition_in_sync_replica",
    () => partitions({ "orders/0": 2, "orders/1": 2, "orders/2": 2, "payments/0": 2, "payments/1": 2 }),
  ],
  ["kafka_topic_partition_oldest_offset", () => partitions({ "orders/0": 1_200_000, "orders/1": 1_190_000 })],
  ["sum by (topic) (rate(", () => [series({ topic: "orders" }, 240), series({ topic: "payments" }, 35)]],
  ["kafka_topic_partition_current_offset", () => partitions({ "orders/0": 1_882_340, "orders/1": 1_880_102 })],
  ["kafka_consumergroup_members", () => [series({ consumergroup: "orders-projector" }, 3)]],
  ["sum by (consumergroup) (rate(", () => [series({ consumergroup: "orders-projector" }, 236)]],
  ["deriv(", () => [series({ consumergroup: "orders-projector" }, 0)]],
  [
    "kafka_consumergroup_lag",
    () => [
      series({ consumergroup: "orders-projector", topic: "orders", partition: "0" }, 40),
      series({ consumergroup: "orders-projector", topic: "orders", partition: "1" }, 12),
    ],
  ],
]

/** The series a query asks of kafka_exporter, or undefined for a query that is not about Kafka. */
export const kafkaAnswer = (query: string) =>
  query.includes("kafka_") ? (answers.find(([start]) => query.startsWith(start))?.[1]() ?? []) : undefined
