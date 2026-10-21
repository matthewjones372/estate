/** kafka_exporter's series for the server's tests: a Prometheus stub answering a cluster's instant queries. */
import { type Call, reply } from "./remote"

const series = (labels: Record<string, string>, value: number) => ({ metric: labels, value: [0, String(value)] })
const partition = (topic: string, id: number, value: number) => series({ topic, partition: String(id) }, value)

/** kafka_exporter's series for three brokers, the third gone ten minutes; orders in trouble, payments well. */
export const exporter = (now: number) => (call: Call) => {
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
