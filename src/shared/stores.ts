/**
 * A store's stats and health from the preset for its engine: the four or five numbers that say whether it is well,
 * read from its exporter's series, and the thresholds past which it needs someone.
 */
import type { Store } from "./catalog"

export interface StoreStat {
  readonly key: string
  readonly title: string
  readonly query: string
  readonly unit?: string
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

/** The preset's stats for the store, narrowed by its selector, then its own. */
export const storeStatsOf = (store: Store): ReadonlyArray<StoreStat> => [
  ...presets[store.engine].stats(store.selector),
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
