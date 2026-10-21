/**
 * A Postgres or cnpg cluster as it is now (spec 0060), from its exporter's series: its instances with the primary
 * first, the clients connected by application name, the databases, and where its WAL goes. Nothing is guessed: a
 * number the exporter did not publish is null, and a part it does not publish at all is named in `missing`.
 */
import { Schema } from "effect"
import type { Reading } from "./kafka-cluster"

const Count = Schema.NullOr(Schema.Number)

const Instance = Schema.Struct({
  name: Schema.String,
  role: Schema.NullOr(Schema.Literals(["primary", "replica"])),
  /** Seconds since it was last seen, when it was seen in the last hour and is not there now. */
  gone: Schema.optionalKey(Schema.Number),
  /** It is the primary now, and was a replica within the hour. */
  promoted: Schema.optionalKey(Schema.Boolean),
  /** Seconds behind the primary, on a replica. */
  lag: Count,
  /** How fast its lag grew over ten minutes, in seconds a second. */
  growing: Count,
  connections: Count,
  maxConnections: Count,
  /** Backends waiting on a lock. */
  waiting: Count,
})
type Instance = typeof Instance.Type

const Client = Schema.Struct({
  name: Schema.String,
  connections: Schema.Number,
  active: Schema.Number,
  idleInTransaction: Schema.Number,
  /** The longest a connection of it has been idle in a transaction, in seconds. */
  longestIdle: Count,
})
type Client = typeof Client.Type

export const PostgresCluster = Schema.Struct({
  engine: Schema.Literal("postgres"),
  readAt: Schema.String,
  /** The major version, where the exporter says it. */
  version: Schema.NullOr(Schema.String),
  instances: Schema.Array(Instance),
  databases: Schema.Array(Schema.Struct({ name: Schema.String, size: Count })),
  clients: Schema.Array(Client),
  /** Each replica streaming from the primary, with the WAL it has not replayed. */
  streaming: Schema.Array(Schema.Struct({ name: Schema.String, sync: Schema.NullOr(Schema.String), behind: Count })),
  slots: Schema.Array(Schema.Struct({ name: Schema.String, active: Schema.Boolean, retained: Count })),
  archive: Schema.NullOr(Schema.Struct({ since: Count, failed: Count })),
  /** Seconds since the last base backup. */
  backup: Count,
  /** The store's thresholds: a replica behind by more seconds, or connections over this share, is amber. */
  limits: Schema.Struct({ lag: Schema.Number, connections: Schema.Number }),
  /** Parts the exporter does not publish, each with what would add them. */
  missing: Schema.Array(Schema.String),
})
export type PostgresCluster = typeof PostgresCluster.Type

type Engine = "postgres" | "cnpg"

/** The label that names an instance on each engine's series. */
const instanceLabel = (engine: Engine) => (engine === "cnpg" ? "pod" : "instance")

/** The exporter's series a cluster is read from, each narrowed by the store's selector. */
export const databaseQueries = (engine: Engine, selector: string) => {
  const s = `{${selector}}`
  const by = instanceLabel(engine)
  const idle = `{state="idle in transaction",${selector}}`
  return engine === "cnpg"
    ? {
        seen: `max_over_time(timestamp(cnpg_collector_up${s})[1h:1m])`,
        recovery: `cnpg_pg_replication_in_recovery${s}`,
        wasReplica: `max_over_time(cnpg_pg_replication_in_recovery${s}[1h])`,
        lag: `cnpg_pg_replication_lag${s}`,
        growing: `deriv(cnpg_pg_replication_lag${s}[10m])`,
        connections: `sum by (${by}) (cnpg_backends_total${s})`,
        maxConnections: `cnpg_pg_settings_setting{name="max_connections",${selector}}`,
        waiting: `sum by (${by}) (cnpg_backends_waiting_total${s})`,
        databases: `cnpg_pg_database_size_bytes${s}`,
        clients: `sum by (application_name, state) (cnpg_backends_total${s})`,
        idle: `max by (application_name) (cnpg_backends_max_tx_duration_seconds${idle})`,
        streaming: `cnpg_pg_stat_replication_replay_diff_bytes${s}`,
        slotActive: `cnpg_pg_replication_slots_active${s}`,
        slotRetained: `cnpg_pg_replication_slots_pg_wal_lsn_diff${s}`,
        archiveSince: `max(cnpg_pg_stat_archiver_seconds_since_last_archival${s})`,
        archiveFailed: `sum(increase(cnpg_pg_stat_archiver_failed_count${s}[1h]))`,
        backup: `time() - max(cnpg_collector_last_available_backup_timestamp${s})`,
        version: `cnpg_collector_postgres_version${s}`,
      }
    : {
        seen: `max_over_time(timestamp(pg_up${s})[1h:1m])`,
        recovery: `pg_replication_is_replica${s}`,
        wasReplica: `max_over_time(pg_replication_is_replica${s}[1h])`,
        lag: `pg_replication_lag_seconds${s}`,
        growing: `deriv(pg_replication_lag_seconds${s}[10m])`,
        connections: `sum by (${by}) (pg_stat_activity_count${s})`,
        maxConnections: `pg_settings_max_connections${s}`,
        waiting: `sum by (${by}) (pg_locks_count{mode="exclusivelock",${selector}})`,
        databases: `pg_database_size_bytes${s}`,
        clients: `sum by (application_name, state) (pg_stat_activity_count${s})`,
        idle: `max by (application_name) (pg_stat_activity_max_tx_duration${idle})`,
        streaming: `pg_stat_replication_pg_wal_lsn_diff${s}`,
        slotActive: `pg_replication_slot_slot_is_active${s}`,
        slotRetained: `pg_replication_slot_safe_wal_size_bytes${s}`,
        archiveSince: `max(pg_stat_archiver_last_archive_age${s})`,
        archiveFailed: `sum(increase(pg_stat_archiver_failed_count${s}[1h]))`,
        backup: "",
        version: `pg_static${s}`,
      }
}

export type DatabaseReadings = Readonly<Record<keyof ReturnType<typeof databaseQueries>, ReadonlyArray<Reading>>>

/** An instance not seen for this long is gone: a few scrapes, so one slow scrape does not take it away. */
const goneAfter = 180

const byLabel = (readings: ReadonlyArray<Reading>, label: string) =>
  new Map(readings.map((reading) => [reading.labels[label] ?? "", reading.value]))

const one = (readings: ReadonlyArray<Reading>) => readings[0]?.value ?? null

const nameOf = (labels: Readonly<Record<string, string>>) => labels["application_name"] || "(no name)"

const clientsFrom = (readings: DatabaseReadings): ReadonlyArray<Client> => {
  const longest = byLabel(readings.idle, "application_name")
  const names = [...new Set(readings.clients.map(({ labels }) => nameOf(labels)))]
  const count = (name: string, state?: string) =>
    readings.clients
      .filter(({ labels }) => nameOf(labels) === name && (state === undefined || labels["state"] === state))
      .reduce((sum, reading) => sum + reading.value, 0)
  return names
    .map((name) => ({
      name,
      connections: count(name),
      active: count(name, "active"),
      idleInTransaction: count(name, "idle in transaction"),
      longestIdle: longest.get(name === "(no name)" ? "" : name) ?? null,
    }))
    .filter((client) => client.connections > 0)
    .sort((a, b) => b.connections - a.connections || a.name.localeCompare(b.name))
}

/** The parts an exporter left out entirely, with what would add them. */
const missingFrom = (engine: Engine, readings: DatabaseReadings) =>
  [
    readings.clients.length === 0
      ? engine === "cnpg"
        ? "clients need cnpg's backends query"
        : "clients need postgres_exporter's stat_activity collector"
      : [],
    readings.archiveSince.length === 0
      ? engine === "cnpg"
        ? "the archive needs cnpg's pg_stat_archiver query"
        : "the archive needs postgres_exporter's stat_archiver collector"
      : [],
    engine === "postgres" ? "base backups are not in postgres_exporter's series" : [],
  ].flat()

/** The cluster from what the exporter said `now` (in seconds): the primary first, then replicas by lag. */
export const databaseFrom = (
  engine: Engine,
  readings: DatabaseReadings,
  limits: PostgresCluster["limits"],
  now: number,
): PostgresCluster => {
  const label = instanceLabel(engine)
  const recovery = byLabel(readings.recovery, label)
  const was = byLabel(readings.wasReplica, label)
  const lags = byLabel(readings.lag, label)
  const growing = byLabel(readings.growing, label)
  const connections = byLabel(readings.connections, label)
  const maxConnections = byLabel(readings.maxConnections, label)
  const waiting = byLabel(readings.waiting, label)
  const instances = readings.seen
    .map(({ labels, value }): Instance => {
      const name = labels[label] ?? ""
      const ago = now - value
      const inRecovery = recovery.get(name)
      const role = inRecovery === undefined ? null : inRecovery > 0 ? ("replica" as const) : ("primary" as const)
      return {
        name,
        role,
        ...(ago > goneAfter ? { gone: Math.round(ago) } : {}),
        ...(role === "primary" && (was.get(name) ?? 0) > 0 ? { promoted: true } : {}),
        lag: role === "replica" ? (lags.get(name) ?? null) : null,
        growing: role === "replica" ? (growing.get(name) ?? null) : null,
        connections: connections.get(name) ?? null,
        maxConnections: maxConnections.get(name) ?? null,
        waiting: waiting.get(name) ?? null,
      }
    })
    .sort(
      (a, b) =>
        Number(a.gone !== undefined) - Number(b.gone !== undefined) ||
        Number(b.role === "primary") - Number(a.role === "primary") ||
        (a.lag ?? 0) - (b.lag ?? 0) ||
        a.name.localeCompare(b.name),
    )
  // A database's size is the largest any instance reports, so a replica that is behind does not shrink it.
  const sizes = new Map<string, number>()
  for (const { labels, value } of readings.databases) {
    const name = labels["datname"] ?? ""
    sizes.set(name, Math.max(sizes.get(name) ?? 0, value))
  }
  const retained = byLabel(readings.slotRetained, "slot_name")
  const version = readings.version[0]?.labels
  return {
    engine: "postgres",
    readAt: new Date(now * 1000).toISOString(),
    version: version?.["major"] ?? version?.["short_version"]?.split(".")[0] ?? null,
    instances,
    databases: [...sizes]
      .map(([name, size]) => ({ name, size }))
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0) || a.name.localeCompare(b.name)),
    clients: clientsFrom(readings),
    streaming: readings.streaming
      .map(({ labels, value }) => ({ name: nameOf(labels), sync: labels["sync_state"] ?? null, behind: value }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    slots: readings.slotActive
      .map(({ labels, value }) => ({
        name: labels["slot_name"] ?? "",
        active: value > 0,
        retained: retained.get(labels["slot_name"] ?? "") ?? null,
      }))
      .sort((a, b) => Number(a.active) - Number(b.active) || a.name.localeCompare(b.name)),
    archive:
      readings.archiveSince.length === 0
        ? null
        : { since: one(readings.archiveSince), failed: one(readings.archiveFailed) },
    backup: one(readings.backup),
    limits,
    missing: missingFrom(engine, readings),
  }
}
