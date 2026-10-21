/** A Kafka cluster in the page's words (spec 0057): what is wrong with it, said in one sentence. */
import { type KafkaCluster, troubled } from "../shared/kafka-cluster"
import { duration } from "./format"

/** Topics Kafka keeps for itself, such as `__consumer_offsets`: hidden until asked for. */
export const internal = (topic: string): boolean => topic.startsWith("__")

const partitionsOf = (topic: string, ids: ReadonlyArray<number>, one: string, many: string) =>
  ids.length === 1 ? `${topic} p${ids[0]} ${one}` : `${ids.length} partitions of ${topic} ${many}`

export const whatIsWrong = (cluster: KafkaCluster): string => {
  const said = [
    ...cluster.brokers.flatMap((broker) =>
      broker.gone === undefined ? [] : [`broker ${broker.id} has been gone ${duration(broker.gone * 1000)}`],
    ),
    ...cluster.topics.flatMap((topic) => {
      const leaderless = topic.partitions.filter((partition) => partition.leader === null).map((each) => each.id)
      const under = topic.partitions
        .filter((partition) => partition.leader !== null && troubled(partition))
        .map((each) => each.id)
      return [
        ...(leaderless.length === 0 ? [] : [partitionsOf(topic.name, leaderless, "has no leader", "have no leader")]),
        ...(under.length === 0 ? [] : [partitionsOf(topic.name, under, "is under-replicated", "are under-replicated")]),
      ]
    }),
  ]
  const sentence = said.length === 0 ? "every broker is up and every partition is in sync" : said.join("; ")
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}
