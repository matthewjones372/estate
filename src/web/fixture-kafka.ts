/** A Kafka store's cluster for the pages' tests: three brokers, the third gone, orders in trouble, payments well. */
import type { KafkaCluster } from "../shared/kafka-cluster"

const partition = (id: number, leader: string | null, inSync: number, preferred = true) => ({
  id,
  leader,
  replicas: 3,
  inSync,
  preferred,
  oldest: 100,
  newest: 1_882_340 + id,
})

export const kafkaCluster: KafkaCluster = {
  readAt: "2026-10-03T11:59:56Z",
  brokers: [
    { id: "1", address: "kafka-0:9092", leads: 2 },
    { id: "2", address: "kafka-1:9092", leads: 2 },
    { id: "3", address: "kafka-2:9092", leads: 0, gone: 600 },
  ],
  topics: [
    {
      name: "orders",
      rate: 240,
      partitions: [partition(0, "1", 2), partition(1, "2", 3, false), partition(2, null, 2), partition(3, "1", 2)],
    },
    { name: "payments", rate: 35, partitions: [partition(0, "2", 3)] },
    { name: "__consumer_offsets", rate: 4, partitions: [partition(0, "1", 3)] },
  ],
  groups: [
    {
      name: "orders-projector",
      members: 3,
      lag: 12_010,
      rate: 230,
      growing: 40,
      partitions: [
        { topic: "orders", partition: 0, offset: 1_870_340, lag: 12_000 },
        { topic: "orders", partition: 1, offset: 1_882_331, lag: 10 },
      ],
    },
  ],
}
