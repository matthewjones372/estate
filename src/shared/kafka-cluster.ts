/**
 * A Kafka cluster as it is now (spec 0057), from kafka_exporter's series: its brokers, each topic's partitions in their
 * leader's hands, and each consumer group's offset and lag on each partition it reads. Nothing is guessed: a number
 * the exporter did not publish is null.
 */
import { Schema } from "effect"

const Count = Schema.NullOr(Schema.Number)

const Broker = Schema.Struct({
  id: Schema.String,
  address: Schema.optionalKey(Schema.String),
  /** How many partitions it leads now. */
  leads: Schema.Number,
  /** Seconds since it was last seen, when it was seen in the last hour and is not there now. */
  gone: Schema.optionalKey(Schema.Number),
})

const Partition = Schema.Struct({
  id: Schema.Number,
  /** The leading broker's id, or null when the partition has no leader. */
  leader: Schema.NullOr(Schema.String),
  replicas: Count,
  inSync: Count,
  preferred: Schema.NullOr(Schema.Boolean),
  oldest: Count,
  newest: Count,
})
export type Partition = typeof Partition.Type

const Topic = Schema.Struct({ name: Schema.String, rate: Count, partitions: Schema.Array(Partition) })

const Group = Schema.Struct({
  name: Schema.String,
  members: Count,
  /** Null when the exporter's lag series could not be read: unknown, not caught up. */
  lag: Count,
  /** Messages it reads a second, from how fast its committed offsets move. */
  rate: Count,
  /** How fast its lag grew over ten minutes, a second. */
  growing: Count,
  partitions: Schema.Array(
    Schema.Struct({ topic: Schema.String, partition: Schema.Number, offset: Count, lag: Count }),
  ),
})

export const KafkaCluster = Schema.Struct({
  readAt: Schema.String,
  brokers: Schema.Array(Broker),
  topics: Schema.Array(Topic),
  groups: Schema.Array(Group),
})
export type KafkaCluster = typeof KafkaCluster.Type

/** One series of an instant query: its labels and its value now. */
export interface Reading {
  readonly labels: Readonly<Record<string, string>>
  readonly value: number
}

/** kafka_exporter's series a cluster is read from, each narrowed by the store's selector. */
export const clusterQueries = (selector: string) => {
  const s = `{${selector}}`
  return {
    seen: `max_over_time(timestamp(kafka_broker_info${s})[1h:1m])`,
    leader: `kafka_topic_partition_leader${s}`,
    replicas: `kafka_topic_partition_replicas${s}`,
    inSync: `kafka_topic_partition_in_sync_replica${s}`,
    preferred: `kafka_topic_partition_leader_is_preferred${s}`,
    oldest: `kafka_topic_partition_oldest_offset${s}`,
    newest: `kafka_topic_partition_current_offset${s}`,
    rate: `sum by (topic) (rate(kafka_topic_partition_current_offset${s}[5m]))`,
    members: `kafka_consumergroup_members${s}`,
    lag: `kafka_consumergroup_lag${s}`,
    offset: `kafka_consumergroup_current_offset${s}`,
    growing: `deriv(sum by (consumergroup) (kafka_consumergroup_lag${s})[10m:1m])`,
    consumed: `sum by (consumergroup) (rate(kafka_consumergroup_current_offset${s}[5m]))`,
  } as const
}

export type Readings = Readonly<Record<keyof ReturnType<typeof clusterQueries>, ReadonlyArray<Reading>>>

/** A broker not seen for this long is gone: a few scrapes, so one slow scrape does not take it away. */
const goneAfter = 180

const key = (labels: Readonly<Record<string, string>>) => `${labels["topic"]}/${labels["partition"]}`

const byKey = (readings: ReadonlyArray<Reading>, of: (labels: Readonly<Record<string, string>>) => string) =>
  new Map(readings.map((reading) => [of(reading.labels), reading.value]))

/** Partitions in trouble: under-replicated, or with no leader. */
export const troubled = (partition: Partition): boolean =>
  partition.leader === null ||
  (partition.inSync !== null && partition.replicas !== null && partition.inSync < partition.replicas)

/** The cluster from what the exporter said `now` (in seconds): topics in trouble first, then the busiest. */
export const clusterFrom = (readings: Readings, now: number): KafkaCluster => {
  const values = (name: keyof Readings) => byKey(readings[name], key)
  const leaders = values("leader")
  const replicas = values("replicas")
  const inSync = values("inSync")
  const preferred = values("preferred")
  const oldest = values("oldest")
  const newest = values("newest")
  const named = [...new Set([...leaders.keys(), ...newest.keys()])]
  const partitionOf = (id: string): Partition => {
    const leader = leaders.get(id)
    const flag = preferred.get(id)
    return {
      id: Number(id.slice(id.lastIndexOf("/") + 1)),
      leader: leader === undefined || leader < 0 ? null : String(leader),
      replicas: replicas.get(id) ?? null,
      inSync: inSync.get(id) ?? null,
      preferred: flag === undefined ? null : flag === 1,
      oldest: oldest.get(id) ?? null,
      newest: newest.get(id) ?? null,
    }
  }
  const rates = byKey(readings.rate, (labels) => labels["topic"] ?? "")
  const topics = [...new Set(named.map((id) => id.slice(0, id.lastIndexOf("/"))))].map((name) => ({
    name,
    rate: rates.get(name) ?? null,
    partitions: named
      .filter((id) => id.slice(0, id.lastIndexOf("/")) === name)
      .map(partitionOf)
      .sort((a, b) => a.id - b.id),
  }))
  const inTrouble = (topic: (typeof topics)[number]) => topic.partitions.some(troubled)
  topics.sort(
    (a, b) =>
      Number(inTrouble(b)) - Number(inTrouble(a)) || (b.rate ?? 0) - (a.rate ?? 0) || a.name.localeCompare(b.name),
  )
  const leads = (id: string) =>
    topics.reduce((sum, topic) => sum + topic.partitions.filter((partition) => partition.leader === id).length, 0)
  const brokers = readings.seen
    .map(({ labels, value }) => ({ id: labels["id"] ?? "", address: labels["address"], ago: now - value }))
    .sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id))
    .map(({ id, address, ago }) => ({
      id,
      ...(address === undefined ? {} : { address }),
      leads: leads(id),
      ...(ago > goneAfter ? { gone: Math.round(ago) } : {}),
    }))
  return { readAt: new Date(now * 1000).toISOString(), brokers, topics, groups: groupsFrom(readings) }
}

const groupsFrom = (readings: Readings): KafkaCluster["groups"] => {
  const groupOf = (labels: Readonly<Record<string, string>>) => labels["consumergroup"] ?? ""
  const members = byKey(readings.members, groupOf)
  const growing = byKey(readings.growing, groupOf)
  const consumed = byKey(readings.consumed, groupOf)
  const perPartition = (labels: Readonly<Record<string, string>>) => `${groupOf(labels)} ${key(labels)}`
  const lags = byKey(readings.lag, perPartition)
  const offsets = byKey(readings.offset, perPartition)
  // A group's partitions are those either series names, so a lag series that fails keeps the offsets.
  const read = [...new Map([...readings.lag, ...readings.offset].map(({ labels }) => [perPartition(labels), labels]))]
  const names = [...new Set([...members.keys(), ...read.map(([, labels]) => groupOf(labels))])]
  return names
    .map((name) => {
      const partitions = read
        .filter(([, labels]) => groupOf(labels) === name)
        .map(([id, labels]) => ({
          topic: labels["topic"] ?? "",
          partition: Number(labels["partition"]),
          offset: offsets.get(id) ?? null,
          lag: lags.get(id) ?? null,
        }))
        .sort((a, b) => a.topic.localeCompare(b.topic) || a.partition - b.partition)
      const known = partitions.filter((partition) => partition.lag !== null)
      return {
        name,
        members: members.get(name) ?? null,
        lag: known.length === 0 ? null : known.reduce((sum, partition) => sum + (partition.lag ?? 0), 0),
        rate: consumed.get(name) ?? null,
        growing: growing.get(name) ?? null,
        partitions,
      }
    })
    .sort((a, b) => (b.lag ?? 0) - (a.lag ?? 0) || a.name.localeCompare(b.name))
}
