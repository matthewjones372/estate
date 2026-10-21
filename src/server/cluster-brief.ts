/** A Kafka cluster as Ask AI reads it (spec 0057): what Estate read of it, in plain lines, the trouble first. */
import type { Store } from "../shared/catalog"
import { type KafkaCluster, type Partition, troubled } from "../shared/kafka-cluster"

const known = (value: number | null) => (value === null ? "unknown" : String(Math.round(value * 100) / 100))

const partitionLine = (topic: string, partition: Partition) =>
  [
    `${topic} p${partition.id}: ${partition.leader === null ? "no leader" : `leader broker ${partition.leader}`}`,
    `${known(partition.inSync)} of ${known(partition.replicas)} replicas in sync`,
    ...(partition.preferred === false ? ["not on its preferred leader"] : []),
  ].join(", ")

export const clusterBrief = (store: Store, environment: string, cluster: KafkaCluster): string =>
  [
    `The Kafka store ${store.name} in ${environment}, read from kafka_exporter at ${cluster.readAt}.`,
    "",
    "Brokers:",
    ...cluster.brokers.map((broker) =>
      broker.gone === undefined
        ? `- broker ${broker.id} (${broker.address ?? "no address"}): up, leads ${broker.leads} partitions`
        : `- broker ${broker.id} (${broker.address ?? "no address"}): gone, last seen ${broker.gone} s ago`,
    ),
    "",
    "Partitions not well:",
    ...cluster.topics.flatMap((topic) =>
      topic.partitions
        .filter((partition) => troubled(partition) || partition.preferred === false)
        .map((partition) => `- ${partitionLine(topic.name, partition)}`),
    ),
    "",
    "Topics, with messages written a second:",
    ...cluster.topics.map(
      (topic) => `- ${topic.name}: ${known(topic.rate)} a second, ${topic.partitions.length} partitions`,
    ),
    "",
    "Consumer groups:",
    ...cluster.groups.map(
      (group) =>
        `- ${group.name}: ${known(group.members)} members, reads ${known(group.rate)} a second, lag ${known(group.lag)}, ` +
        `growing ${known(group.growing)} a second; lag by partition: ${group.partitions
          .map((each) => `${each.topic} p${each.partition} ${known(each.lag)}`)
          .join(", ")}`,
    ),
  ].join("\n")
