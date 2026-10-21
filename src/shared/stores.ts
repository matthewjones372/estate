/**
 * A store's stats and health from the preset for its engine: the four or five numbers that say whether it is well,
 * read from its exporter's series, and the thresholds past which it needs someone.
 */
import { Schema } from "effect"
import type { Store } from "./catalog"

const optional = Schema.optionalKey

/** A store as the page is told of it, its links filled in, and where it was found when it was not written. */
export const DescribedStore = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  category: optional(Schema.String),
  engine: Schema.String,
  links: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })),
  /** Found, not written (spec 0057): where, and the entry as YAML to put in the catalog. */
  discovered: optional(Schema.Struct({ from: Schema.String, yaml: Schema.String })),
})

export interface StoreStat {
  readonly key: string
  readonly title: string
  readonly query: string
  readonly unit?: string
  /** A count read for the lane's instance dots (spec 0060), not drawn as a chart. */
  readonly count?: true
}

/** Past `threshold`, read from the stat `key`, the store needs attention, and `says` why. */
export interface Rule {
  readonly key: string
  readonly threshold: number
  readonly says: (value: number) => string
}

interface Preset {
  readonly stats: (selector: string) => ReadonlyArray<StoreStat>
  readonly rules: ReadonlyArray<Rule>
}

const round = (value: number) => (Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10)

const postgresRules: ReadonlyArray<Rule> = [
  { key: "connections", threshold: 80, says: (value) => `${round(value)}% of its connections are in use` },
  { key: "lag", threshold: 30, says: (value) => `a replica is ${round(value)} s behind` },
]

const presets: Readonly<Record<Store["engine"], Preset>> = {
  postgres: {
    stats: (s) => [
      {
        key: "connections",
        title: "Connections used",
        query: `100 * sum(pg_stat_activity_count{${s}}) / max(pg_settings_max_connections{${s}})`,
        unit: "%",
      },
      {
        key: "transactions",
        title: "Transactions",
        query: `sum(rate(pg_stat_database_xact_commit{${s}}[5m])) + sum(rate(pg_stat_database_xact_rollback{${s}}[5m]))`,
        unit: "/s",
      },
      { key: "lag", title: "Replication lag", query: `max(pg_replication_lag_seconds{${s}})`, unit: "s" },
      { key: "size", title: "Size", query: `sum(pg_database_size_bytes{${s}})`, unit: "bytes" },
      { key: "deadlocks", title: "Deadlocks", query: `sum(rate(pg_stat_database_deadlocks{${s}}[5m]))`, unit: "/s" },
    ],
    rules: postgresRules,
  },
  cnpg: {
    stats: (s) => [
      {
        key: "connections",
        title: "Connections used",
        query: `100 * sum(cnpg_backends_total{${s}}) / max(cnpg_pg_settings_setting{name="max_connections",${s}})`,
        unit: "%",
      },
      {
        key: "transactions",
        title: "Transactions",
        query: `sum(rate(cnpg_pg_stat_database_xact_commit{${s}}[5m]))`,
        unit: "/s",
      },
      { key: "lag", title: "Replication lag", query: `max(cnpg_pg_replication_lag{${s}})`, unit: "s" },
      { key: "size", title: "Size", query: `sum(cnpg_pg_database_size_bytes{${s}})`, unit: "bytes" },
      { key: "down", title: "Instances not ready", query: `count(cnpg_collector_up{${s}} == 0) or vector(0)` },
      {
        key: "backup",
        title: "Since the last backup",
        query: `time() - max(cnpg_collector_last_available_backup_timestamp{${s}})`,
        unit: "s",
      },
    ],
    rules: [
      ...postgresRules,
      {
        key: "down",
        threshold: 0,
        says: (value) => `${value} instance${value === 1 ? " is" : "s are"} not ready`,
      },
      { key: "backup", threshold: 86_400, says: (value) => `no backup for ${round(value / 3600)} h` },
    ],
  },
  mysql: {
    stats: (s) => [
      {
        key: "connections",
        title: "Connections used",
        query: `100 * sum(mysql_global_status_threads_connected{${s}}) / max(mysql_global_variables_max_connections{${s}})`,
        unit: "%",
      },
      { key: "queries", title: "Queries", query: `sum(rate(mysql_global_status_queries{${s}}[5m]))`, unit: "/s" },
      { key: "lag", title: "Replica lag", query: `max(mysql_slave_status_seconds_behind_master{${s}})`, unit: "s" },
      {
        key: "slow",
        title: "Slow queries",
        query: `sum(rate(mysql_global_status_slow_queries{${s}}[5m]))`,
        unit: "/s",
      },
    ],
    rules: postgresRules,
  },
  redis: {
    stats: (s) => [
      {
        key: "memory",
        title: "Memory used",
        query: `100 * sum(redis_memory_used_bytes{${s}}) / sum(redis_memory_max_bytes{${s}})`,
        unit: "%",
      },
      {
        key: "hits",
        title: "Hit rate",
        query: `100 * sum(rate(redis_keyspace_hits_total{${s}}[5m])) / (sum(rate(redis_keyspace_hits_total{${s}}[5m])) + sum(rate(redis_keyspace_misses_total{${s}}[5m])))`,
        unit: "%",
      },
      { key: "evictions", title: "Evictions", query: `sum(rate(redis_evicted_keys_total{${s}}[5m]))`, unit: "/s" },
      { key: "clients", title: "Clients", query: `sum(redis_connected_clients{${s}})` },
    ],
    rules: [
      { key: "memory", threshold: 90, says: (value) => `${round(value)}% of its memory is used` },
      { key: "evictions", threshold: 0, says: (value) => `evicting ${round(value)} keys a second` },
    ],
  },
  kafka: {
    stats: (s) => [
      {
        key: "messages",
        title: "Messages in",
        query: `sum(rate(kafka_topic_partition_current_offset{${s}}[5m]))`,
        unit: "/s",
      },
      { key: "lag", title: "Consumer lag", query: `sum(kafka_consumergroup_lag{${s}})` },
      {
        key: "growing",
        title: "Lag growth",
        query: `deriv(sum(kafka_consumergroup_lag{${s}})[10m:1m])`,
        unit: "/s",
      },
      {
        key: "underReplicated",
        title: "Under-replicated partitions",
        query: `sum(kafka_topic_partition_under_replicated_partition{${s}})`,
      },
    ],
    rules: [
      { key: "growing", threshold: 0, says: () => "consumer lag has grown for ten minutes" },
      {
        key: "underReplicated",
        threshold: 0,
        says: (value) => `${value} partition${value === 1 ? " is" : "s are"} under-replicated`,
      },
    ],
  },
}

export const engines = Object.keys(presets) as ReadonlyArray<Store["engine"]>

/** A database's instances counted by role, those behind its lag threshold and those gone, for its lane's dots. */
const instanceCounts = (store: Store, lag: number): ReadonlyArray<StoreStat> => {
  const s = `{${store.selector}}`
  const [recovery, lagged, up] =
    store.engine === "cnpg"
      ? ["cnpg_pg_replication_in_recovery", "cnpg_pg_replication_lag", "cnpg_collector_up"]
      : store.engine === "postgres"
        ? ["pg_replication_is_replica", "pg_replication_lag_seconds", "pg_up"]
        : []
  if (recovery === undefined) return []
  const counted = (key: string, title: string, query: string) => ({
    key,
    title,
    query: `count(${query}) or vector(0)`,
    count: true as const,
  })
  return [
    counted("primaries", "Primaries", `${recovery}${s} == 0`),
    counted("replicas", "Replicas", `${recovery}${s} == 1`),
    counted("behind", "Replicas behind", `${lagged}${s} > ${lag}`),
    counted("gone", "Instances gone", `${up}${s} == 0`),
  ]
}

/** The keys of the counts read for a lane's dots, which are not sent as stats. */
const countKeys = new Set(["primaries", "replicas", "behind", "gone"])
export const isCount = (key: string) => countKeys.has(key)

/** A database's instances as its lane draws them, from its counts now; undefined where none were read. */
export const instancesOf = (now: Readonly<Record<string, number | null | undefined>>) => {
  const [primaries, replicas, behind, gone] = ["primaries", "replicas", "behind", "gone"].map((key) => now[key] ?? null)
  if (primaries === null && replicas === null) return undefined
  return { primaries: primaries ?? 0, replicas: replicas ?? 0, behind: behind ?? 0, gone: gone ?? 0 }
}

/** The preset's stats for the store, narrowed by its selector, the counts its lane's dots need, then its own. */
export const storeStatsOf = (store: Store): ReadonlyArray<StoreStat> => [
  ...presets[store.engine].stats(store.selector),
  ...instanceCounts(store, rulesOf(store).find((rule) => rule.key === "lag")?.threshold ?? 30),
  ...(store.extra ?? []).map((extra, index) => ({ key: `extra${index}`, ...extra })),
]

/** The preset's rules, with any thresholds the catalog sets for this store. */
export const rulesOf = (store: Store): ReadonlyArray<Rule> =>
  presets[store.engine].rules.map((rule) => ({ ...rule, threshold: store.attention?.[rule.key] ?? rule.threshold }))

/** Why the store needs someone, from its stats now: nothing when it is well, or when nothing was read. */
export const reasonsOf = (store: Store, now: Readonly<Record<string, number | null>>): ReadonlyArray<string> =>
  rulesOf(store).flatMap((rule) => {
    const value = now[rule.key]
    return value === null || value === undefined || !(value > rule.threshold) ? [] : [rule.says(value)]
  })
