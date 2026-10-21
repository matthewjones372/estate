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

type Group = KafkaCluster["groups"][number]

/** A group's partitions far behind the rest of its own: over a thousand messages, and ten times the others' median. */
export const behind = (group: Group): Group["partitions"] =>
  group.partitions.filter((partition, index) => {
    const others = group.partitions
      .filter((_, other) => other !== index)
      .map((each) => each.lag ?? 0)
      .sort((a, b) => a - b)
    const median = others[Math.floor(others.length / 2)]
    const lag = partition.lag ?? 0
    return median !== undefined && lag > 1000 && lag > 10 * median
  })

/** "orders p0 is behind the rest", or nothing when no partition is. */
export const behindWords = (group: Group): string | undefined => {
  const far = behind(group).map((each) => `${each.topic} p${each.partition}`)
  return far.length === 0 ? undefined : `${far.join(", ")} ${far.length === 1 ? "is" : "are"} behind the rest`
}

/**
 * How fast a flow moves for a rate a second: one step for each ten times more, since a cluster's topics run from a
 * message a minute to thousands a second. None for no messages or no reading.
 */
export const flowStep = (rate: number | null): 0 | 1 | 2 | 3 | 4 | 5 => {
  if (rate === null || !(rate > 0)) return 0
  if (rate < 1) return 1
  if (rate < 10) return 2
  if (rate < 100) return 3
  return rate < 1000 ? 4 : 5
}
