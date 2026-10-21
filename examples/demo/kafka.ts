/**
 * The demo's Kafka clusters, alive: each partition's newest offset moves at its topic's rate, each group's committed
 * offset follows it at its lag, and kafka_exporter's series are read off that at any moment. In production, bus has
 * lost broker 4 and picking is falling behind on orders; staging's bus is three brokers, all well.
 */
import { at, type Environment, started } from "./clock"

interface Topic {
  readonly name: string
  readonly partitions: number
  /** Messages a second, across its partitions. */
  readonly rate: number
}

interface Group {
  readonly name: string
  /** The service whose consumers it is, for the spans they write. */
  readonly service: string
  readonly topics: ReadonlyArray<string>
  readonly members: number
  /** Messages behind on a partition when the world started. */
  readonly lag: (topic: string, partition: number) => number
  /** How many messages a second its lag grows by on each partition, from when the world started. */
  readonly growing?: number
}

export interface Cluster {
  readonly name: string
  readonly namespace: string
  readonly brokers: number
  readonly racks: ReadonlyArray<string>
  /** A broker that has gone, and how many seconds before the world started it was last seen. */
  readonly gone?: { readonly id: number; readonly before: number }
  readonly replicas: number
  readonly topics: ReadonlyArray<Topic>
  readonly groups: ReadonlyArray<Group>
}

const steady = (lag: number) => () => lag

const orders: Topic = { name: "orders", partitions: 12, rate: 240 }

const bus = (environment: Environment): Cluster =>
  environment === "production"
    ? {
        name: "bus",
        namespace: "data",
        brokers: 6,
        racks: ["zone-a", "zone-b", "zone-c"],
        gone: { id: 4, before: 9 * 60 },
        replicas: 3,
        topics: [
          orders,
          { name: "payments", partitions: 6, rate: 60 },
          { name: "stock", partitions: 6, rate: 420 },
          { name: "deliveries", partitions: 6, rate: 18 },
          { name: "notifications", partitions: 3, rate: 75 },
          { name: "__consumer_offsets", partitions: 10, rate: 30 },
        ],
        groups: [
          {
            name: "picking",
            service: "picking",
            topics: ["orders"],
            members: 3,
            // One partition far behind the rest, as when its consumer was on broker 4's leader and lost it.
            lag: (_, partition) => (partition === 7 ? 26_000 : 2_100 + ((partition * 137) % 400)),
            growing: 2,
          },
          {
            name: "notifications-sender",
            service: "notifications",
            topics: ["orders", "deliveries"],
            members: 2,
            lag: steady(3),
          },
          { name: "ledger", service: "payments", topics: ["payments"], members: 2, lag: steady(1) },
          { name: "inventory-sync", service: "inventory", topics: ["stock"], members: 3, lag: steady(12) },
          {
            name: "delivery-planner",
            service: "delivery",
            topics: ["orders", "deliveries"],
            members: 2,
            lag: steady(6),
          },
        ],
      }
    : {
        name: "bus",
        namespace: "data",
        brokers: 3,
        racks: ["zone-a"],
        replicas: 3,
        topics: [
          { name: "orders", partitions: 12, rate: 4 },
          { name: "payments", partitions: 6, rate: 1 },
          { name: "stock", partitions: 6, rate: 9 },
          { name: "deliveries", partitions: 6, rate: 0.5 },
          { name: "notifications", partitions: 3, rate: 2 },
        ],
        groups: [
          { name: "picking", service: "picking", topics: ["orders"], members: 1, lag: steady(0) },
          {
            name: "notifications-sender",
            service: "notifications",
            topics: ["orders", "deliveries"],
            members: 1,
            lag: steady(0),
          },
          { name: "ledger", service: "payments", topics: ["payments"], members: 1, lag: steady(0) },
          { name: "inventory-sync", service: "inventory", topics: ["stock"], members: 1, lag: steady(1) },
        ],
      }

const clickstream: Cluster = {
  name: "clickstream",
  namespace: "analytics",
  brokers: 3,
  racks: ["zone-a", "zone-b", "zone-c"],
  replicas: 2,
  topics: [
    { name: "page-views", partitions: 9, rate: 1_800 },
    { name: "searches", partitions: 6, rate: 320 },
  ],
  groups: [
    {
      name: "warehouse-loader",
      service: "recommendations",
      topics: ["page-views", "searches"],
      members: 4,
      lag: steady(900),
    },
    {
      name: "recommendations-trainer",
      service: "recommendations",
      topics: ["page-views"],
      members: 2,
      lag: steady(40),
    },
  ],
}

export const clustersIn = (environment: Environment): ReadonlyArray<Cluster> =>
  environment === "production" ? [bus(environment), clickstream] : [bus(environment)]

/** Offsets count from a day before the world started, so they are large and differ by partition. */
const origin = started - 86_400_000

export const newest = (topic: Topic, partition: number, time: number) =>
  Math.floor(1_000_000 + partition * 31_337 + ((topic.rate / topic.partitions) * (time - origin)) / 1000)

export const lagOf = (group: Group, topic: string, partition: number, time: number) =>
  Math.max(0, Math.round(group.lag(topic, partition) + ((group.growing ?? 0) * Math.max(0, time - started)) / 1000))

export const committed = (cluster: Cluster, group: Group, topic: Topic, partition: number, time: number) =>
  newest(topic, partition, time) - lagOf(group, topic.name, partition, time)

/** When the group's committed offset first passed this one on the partition, or undefined if it has not yet. */
export const passedAt = (
  cluster: Cluster,
  group: Group,
  topic: Topic,
  partition: number,
  offset: number,
  from: number,
) => {
  const now = Date.now()
  if (committed(cluster, group, topic, partition, now) <= offset) return undefined
  let [low, high] = [from, now]
  while (high - low > 50) {
    const middle = (low + high) / 2
    if (committed(cluster, group, topic, partition, middle) > offset) high = middle
    else low = middle
  }
  return high
}

/** Each partition's replicas, the first its preferred leader; its leader the first replica on a broker still up. */
export const placed = (cluster: Cluster, topic: Topic, partition: number) => {
  const shift = topic.name.length
  const replicas = Array.from({ length: cluster.replicas }, (_, index) => (partition + shift + index) % cluster.brokers)
  const alive = replicas.filter((broker) => broker !== cluster.gone?.id)
  return { replicas, leader: alive[0] ?? -1, inSync: alive.length }
}

type Labels = Record<string, string>
const series = (metric: Labels, value: number) => ({ metric, value: [at(), String(value)] })

const partitionsOf = (cluster: Cluster) =>
  cluster.topics.flatMap((topic) => Array.from({ length: topic.partitions }, (_, id) => ({ topic, id })))

/** The cluster's series for one of kafka_exporter's queries, as Estate asks it, narrowed by topic or partition. */
export const exporterAnswer = (cluster: Cluster, query: string, now = Date.now()) => {
  const topicAsked = /topic="([^"]+)"/.exec(query)?.[1]
  const partitionAsked = /partition="([^"]+)"/.exec(query)?.[1]
  const each = (value: (topic: Topic, id: number) => number) =>
    partitionsOf(cluster)
      .filter(
        ({ topic, id }) => (topicAsked ?? topic.name) === topic.name && (partitionAsked ?? String(id)) === String(id),
      )
      .map(({ topic, id }) => series({ topic: topic.name, partition: String(id) }, value(topic, id)))
  const perGroupPartition = (value: (group: Group, topic: Topic, id: number) => number) =>
    cluster.groups.flatMap((group) =>
      partitionsOf(cluster)
        .filter(({ topic, id }) => group.topics.includes(topic.name) && (topicAsked ?? topic.name) === topic.name)
        .filter(({ id }) => (partitionAsked ?? String(id)) === String(id))
        .map(({ topic, id }) =>
          series({ consumergroup: group.name, topic: topic.name, partition: String(id) }, value(group, topic, id)),
        ),
    )
  const readOf = (group: Group) =>
    cluster.topics
      .filter((topic) => group.topics.includes(topic.name) && (topicAsked ?? topic.name) === topic.name)
      .reduce(
        (sum, topic) => sum + (topic.rate / topic.partitions) * (partitionAsked === undefined ? topic.partitions : 1),
        0,
      ) - (group.growing ?? 0)
  if (query.startsWith("max_over_time(timestamp(kafka_broker_info"))
    return Array.from({ length: cluster.brokers }, (_, id) =>
      series(
        {
          id: String(id),
          address: `${cluster.name}-kafka-${id}.${cluster.namespace}:9092`,
          rack: cluster.racks[id % cluster.racks.length] ?? "",
        },
        id === cluster.gone?.id ? started / 1000 - cluster.gone.before : at() - 15,
      ),
    )
  if (query.startsWith("kafka_topic_partition_leader_is_preferred"))
    return each((topic, id) => {
      const place = placed(cluster, topic, id)
      return place.leader === place.replicas[0] ? 1 : 0
    })
  if (query.startsWith("kafka_topic_partition_leader")) return each((topic, id) => placed(cluster, topic, id).leader)
  if (query.startsWith("kafka_topic_partition_replicas")) return each(() => cluster.replicas)
  if (query.startsWith("kafka_topic_partition_in_sync_replica"))
    return each((topic, id) => placed(cluster, topic, id).inSync)
  if (query.startsWith("kafka_topic_partition_oldest_offset"))
    return each((topic, id) => newest(topic, id, now - 6 * 3_600_000))
  if (query.startsWith("sum by (topic) (rate("))
    return cluster.topics.map((topic) => series({ topic: topic.name }, topic.rate))
  if (query.startsWith("kafka_topic_partition_current_offset")) return each((topic, id) => newest(topic, id, now))
  if (query.startsWith("kafka_consumergroup_members"))
    return cluster.groups.map((group) => series({ consumergroup: group.name }, group.members))
  if (query.startsWith("sum by (consumergroup) (rate("))
    return cluster.groups.flatMap((group) => {
      const read = readOf(group)
      return read > 0 ? [series({ consumergroup: group.name }, read)] : []
    })
  if (query.startsWith("deriv("))
    return cluster.groups.map((group) => {
      const partitions = cluster.topics.filter((topic) => group.topics.includes(topic.name))
      return series(
        { consumergroup: group.name },
        (group.growing ?? 0) * partitions.reduce((sum, t) => sum + t.partitions, 0),
      )
    })
  if (query.startsWith("kafka_consumergroup_lag"))
    return perGroupPartition((group, topic, id) => lagOf(group, topic.name, id, now))
  if (query.startsWith("kafka_consumergroup_current_offset"))
    return perGroupPartition((group, topic, id) => committed(cluster, group, topic, id, now))
  return []
}

/** One number for a store's stats over time: what the Kafka preset's queries sum to at `time`. */
export const statOf = (cluster: Cluster, query: string, time: number): number | undefined => {
  if (query.includes("under_replicated"))
    return partitionsOf(cluster).filter(({ topic, id }) => placed(cluster, topic, id).inSync < cluster.replicas).length
  if (query.startsWith("deriv(")) return cluster.groups.reduce((sum, group) => sum + (group.growing ?? 0) * 12, 0)
  if (query.includes("kafka_consumergroup_lag"))
    return cluster.groups.reduce(
      (sum, group) =>
        sum +
        partitionsOf(cluster)
          .filter(({ topic }) => group.topics.includes(topic.name))
          .reduce((each, { topic, id }) => each + lagOf(group, topic.name, id, time), 0),
      0,
    )
  if (query.includes("kafka_topic_partition_current_offset"))
    return cluster.topics.reduce((sum, topic) => sum + topic.rate, 0)
  return undefined
}

/** The cluster a query names by its selector, or undefined for a query that is not about Kafka. */
export const clusterAsked = (environment: Environment, query: string): Cluster | undefined => {
  if (!query.includes("kafka_")) return undefined
  const named = /strimzi_io_cluster="([^"]+)"/.exec(query)?.[1]
  return clustersIn(environment).find((cluster) => cluster.name === named)
}

/** kafka_exporter's count of brokers, by the labels the catalog's kafka rule tells clusters apart by. */
export const discovered = (environment: Environment) =>
  clustersIn(environment).map((cluster) =>
    series(
      { namespace: cluster.namespace, strimzi_io_cluster: cluster.name },
      cluster.brokers - (cluster.gone === undefined ? 0 : 1),
    ),
  )

export { orders }
