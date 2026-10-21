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

/** A group's committed offset on each partition of orders it reads. */
const committed = (group: string, id: number, value: number) =>
  series({ consumergroup: group, topic: "orders", partition: String(id) }, value)

/**
 * kafka_exporter's offsets for following a message written to orders 0 at 1 882 340: orders-projector has read it,
 * billing is 11 400 messages before it at 47.5 a second, and audit is past it with no span of its own.
 */
export const offsetsNow =
  (billing = 1_870_940) =>
  (call: Call) => {
    const url = new URL(call.url)
    if (url.pathname !== "/api/v1/query") return undefined
    const query = url.searchParams.get("query") ?? ""
    if (query.startsWith("kafka_consumergroup_current_offset{"))
      return reply({
        data: {
          result: [
            committed("orders-projector", 0, 1_882_341),
            committed("billing", 0, billing),
            committed("billing", 1, 77),
            committed("audit", 0, 1_882_400),
          ],
        },
      })
    if (query.startsWith("sum by (consumergroup) (rate(kafka_consumergroup_current_offset{"))
      return reply({ data: { result: [series({ consumergroup: "billing" }, 47.5)] } })
    return reply({ data: { result: [] } })
  }

const nanos = (millis: number) => `${millis}000000`
const text = (key: string, value: string) => ({ key, value: { stringValue: value } })

/** When the followed message was written, in milliseconds since the epoch. */
export const writtenAt = Date.parse("2026-10-21T09:41:02.114Z")

const traced = (service: string, span: Record<string, unknown>) => ({
  resource: { attributes: [text("service.name", service)] },
  scopeSpans: [{ spans: [span] }],
})

/** Tempo holding trace 4bf92f35: petshop writes order 81723 to orders 0, and orders-projector reads it 276 ms later. */
export const tempoNow = (call: Call) => {
  const url = new URL(call.url)
  if (url.pathname === "/api/search")
    return reply({ traces: url.searchParams.get("q")?.includes('"81723"') ? [{ traceID: "4bf92f35" }] : [] })
  if (url.pathname === "/api/traces/4bf92f35")
    return reply({
      batches: [
        traced("petshop", {
          spanId: "p1",
          name: "publish",
          kind: 4,
          startTimeUnixNano: nanos(writtenAt - 3),
          endTimeUnixNano: nanos(writtenAt),
          attributes: [
            text("messaging.operation.type", "send"),
            text("messaging.destination.name", "orders"),
            text("messaging.destination.partition.id", "0"),
            { key: "messaging.kafka.offset", value: { intValue: "1882340" } },
            text("messaging.kafka.message.key", "cust-118"),
            text("messaging.message.id", "81723"),
          ],
        }),
        traced("petshop-projector", {
          spanId: "c1",
          parentSpanId: "p1",
          name: "process",
          kind: 5,
          startTimeUnixNano: nanos(writtenAt + 276),
          endTimeUnixNano: nanos(writtenAt + 280),
          attributes: [
            text("messaging.operation.type", "process"),
            text("messaging.destination.name", "orders"),
            text("messaging.consumer.group.name", "orders-projector"),
          ],
        }),
      ],
    })
  if (url.pathname === "/api/traces/5e1f")
    return reply({
      batches: [traced("petshop", { spanId: "x", name: "GET /", startTimeUnixNano: "0", endTimeUnixNano: "1" })],
    })
  return undefined
}
