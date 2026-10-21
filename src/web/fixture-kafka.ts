/** A Kafka store's cluster for the pages' tests: three brokers, the third gone, orders in trouble, payments well. */
import type { AskAnswer } from "../shared/ask"
import type { KafkaCluster } from "../shared/kafka-cluster"
import type { FollowedMessage } from "../shared/kafka-message"

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

/** Ask AI's answer about the cluster. */
export const clusterAnswer: AskAnswer = {
  likelyCause: "Broker 3 left the cluster, so its partitions lost a replica and orders 2 lost its leader.",
  evidence: [{ text: "broker 3 not seen for 10 min" }],
  nextSteps: ["bring broker 3 back"],
  confidence: "high",
  model: "fake-model",
  read: ["Cluster"],
  called: [],
  usage: { input: 300, cached: 0, output: 40 },
  readLogs: false,
}

/** When the followed message was written to orders 0. */
const writtenAt = Date.parse("2026-10-03T11:58:02.114Z")

/** A message followed: written to orders 0, read by audit, and orders-projector 11,400 messages short of it. */
export const followedMessage: FollowedMessage = {
  trace: "4bf92f35",
  readAt: "2026-10-03T11:59:56Z",
  written: {
    service: "petshop",
    topic: "orders",
    partition: 0,
    offset: 1_882_340,
    key: "cust-118",
    id: "81723",
    at: writtenAt,
  },
  groups: [
    { name: "audit", state: "read", service: "audit-sink", at: writtenAt + 888, after: 888 },
    { name: "orders-projector", state: "not yet", offset: 1_870_940, before: 11_400, seconds: 240 },
  ],
  done: false,
  missing: [],
}

/** The same message once orders-projector's offset has moved past it. */
export const caughtUp: FollowedMessage = {
  ...followedMessage,
  groups: [
    followedMessage.groups[0] ?? { name: "audit", state: "unknown" },
    { name: "orders-projector", state: "past it", offset: 1_882_400 },
  ],
  done: true,
}
