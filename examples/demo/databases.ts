/**
 * The demo's Postgres clusters, run by cnpg: their instances, clients, slots and archive as cnpg's exporter publishes
 * them. In production, orders-db's async replica has fallen behind while a reporting job sits idle in a transaction,
 * and an old change-data-capture slot nobody reads holds WAL on the primary.
 */
import { databaseQueries } from "../../src/shared/postgres-cluster"
import { at, type Environment, started, wave } from "./clock"
import { shopTrafficOf } from "./traffic"

interface Instance {
  readonly name: string
  readonly replica: boolean
  /** Seconds behind, at a moment in seconds since the epoch. */
  readonly lag: (seconds: number) => number
  readonly sync?: string
}

interface Cluster {
  readonly name: string
  readonly instances: ReadonlyArray<Instance>
  readonly clients: ReadonlyArray<{ readonly name: string; readonly connections: number; readonly idle?: number }>
  readonly databases: ReadonlyArray<readonly [string, number]>
  readonly slots: ReadonlyArray<{ readonly name: string; readonly active: boolean; readonly retained: number }>
}

const since = (seconds: number) => Math.max(0, seconds - started / 1000)

const clustersOf = (environment: Environment): ReadonlyArray<Cluster> =>
  environment === "production"
    ? [
        {
          name: "orders-db",
          instances: [
            { name: "orders-db-1", replica: false, lag: () => 0 },
            { name: "orders-db-2", replica: true, lag: wave(0.3, 0.2, 1), sync: "sync" },
            // Further behind each minute while the reporting job's transaction holds its replay back.
            { name: "orders-db-3", replica: true, lag: (seconds) => 38 + since(seconds) * 0.05, sync: "async" },
          ],
          clients: [
            { name: "checkout", connections: 24 },
            { name: "orders", connections: 16 },
            { name: "pricing", connections: 6 },
            { name: "reporting", connections: 3, idle: 260 },
          ],
          databases: [
            ["orders", 48.2e9],
            ["postgres", 8e6],
          ],
          slots: [
            { name: "orders_db_2", active: true, retained: 0 },
            { name: "orders_db_3", active: true, retained: 1.4e9 },
            { name: "analytics_cdc", active: false, retained: 2.1e9 },
          ],
        },
        {
          name: "stock-db",
          instances: [
            { name: "stock-db-1", replica: false, lag: () => 0 },
            { name: "stock-db-2", replica: true, lag: wave(0.4, 0.2, 2), sync: "sync" },
            { name: "stock-db-3", replica: true, lag: wave(0.6, 0.3, 3), sync: "async" },
          ],
          clients: [
            { name: "inventory", connections: 18 },
            { name: "picking", connections: 9 },
          ],
          databases: [["stock", 12.4e9]],
          slots: [
            { name: "stock_db_2", active: true, retained: 0 },
            { name: "stock_db_3", active: true, retained: 0 },
          ],
        },
      ]
    : [
        {
          name: "orders-db",
          instances: [
            { name: "orders-db-1", replica: false, lag: () => 0 },
            { name: "orders-db-2", replica: true, lag: wave(0.2, 0.1, 4), sync: "sync" },
          ],
          clients: [
            { name: "checkout", connections: 4 },
            { name: "orders", connections: 3 },
          ],
          databases: [["orders", 2.1e9]],
          slots: [{ name: "orders_db_2", active: true, retained: 0 }],
        },
        {
          name: "stock-db",
          instances: [{ name: "stock-db-1", replica: false, lag: () => 0 }],
          clients: [{ name: "inventory", connections: 3 }],
          databases: [["stock", 0.9e9]],
          slots: [],
        },
      ]

const clusterAsked = (environment: Environment, query: string) => {
  const name = /cnpg_io_cluster="([^"]+)"/.exec(query)?.[1]
  return clustersOf(environment).find((cluster) => cluster.name === name)
}

type Labels = Record<string, string>
const series = (metric: Labels, value: number) => ({ metric, value: [at(), String(value)] })

/** Connections each client holds now: the shop's traffic brings more of checkout's and orders'. */
const connectionsOf = (cluster: Cluster, environment: Environment, seconds: number) =>
  cluster.clients.map((client) => ({
    ...client,
    connections: Math.round(
      client.connections * (["checkout", "orders"].includes(client.name) ? shopTrafficOf(environment, seconds) : 1),
    ),
  }))

/** cnpg's series for one of the cluster read's instant queries, as Estate asks them. */
const answersOf = (cluster: Cluster, environment: Environment, seconds: number) => {
  const pod = (instance: Instance, value: number, more: Labels = {}) => series({ pod: instance.name, ...more }, value)
  const clients = connectionsOf(cluster, environment, seconds)
  const total = clients.reduce((sum, client) => sum + client.connections, 0)
  const primary = cluster.instances.find((instance) => !instance.replica)
  return {
    seen: cluster.instances.map((instance) => pod(instance, at() - 15)),
    recovery: cluster.instances.map((instance) => pod(instance, instance.replica ? 1 : 0)),
    wasReplica: cluster.instances.map((instance) => pod(instance, instance.replica ? 1 : 0)),
    lag: cluster.instances.map((instance) => pod(instance, instance.lag(seconds))),
    growing: cluster.instances.map((instance) => pod(instance, instance.name === "orders-db-3" ? 0.05 : 0)),
    connections: cluster.instances.map((instance) => pod(instance, instance.replica ? 5 : total)),
    maxConnections: cluster.instances.map((instance) => pod(instance, 100)),
    waiting: primary === undefined ? [] : [pod(primary, cluster.name === "orders-db" ? 2 : 0)],
    databases: cluster.databases.map(([name, size]) => series({ datname: name, pod: primary?.name ?? "" }, size)),
    clients: clients.flatMap((client) => [
      series({ application_name: client.name, state: "active" }, Math.ceil(client.connections / 4)),
      series(
        { application_name: client.name, state: "idle" },
        client.connections - Math.ceil(client.connections / 4) - (client.idle === undefined ? 0 : 1),
      ),
      ...(client.idle === undefined
        ? []
        : [series({ application_name: client.name, state: "idle in transaction" }, 1)]),
    ]),
    idle: clients.flatMap((client) =>
      client.idle === undefined ? [] : [series({ application_name: client.name }, client.idle + since(seconds))],
    ),
    streaming: cluster.instances
      .filter((instance) => instance.replica)
      .map((instance) =>
        series({ application_name: instance.name, sync_state: instance.sync ?? "async" }, instance.lag(seconds) * 4e7),
      ),
    slotActive: cluster.slots.map((slot) => series({ slot_name: slot.name }, slot.active ? 1 : 0)),
    slotRetained: cluster.slots.map((slot) =>
      series({ slot_name: slot.name }, slot.retained + (slot.active ? 0 : since(seconds) * 2e5)),
    ),
    archiveSince: [series({}, 12 + (Math.round(seconds) % 40))],
    archiveFailed: [series({}, 0)],
    backup: [series({}, 5 * 3600 + since(seconds))],
    version: [series({ full: "17.4", major: "17" }, 1)],
  }
}

/** The answer to one of the cluster read's instant queries, or undefined for a query that is not one of them. */
export const databaseAnswer = (environment: Environment, query: string) => {
  const cluster = clusterAsked(environment, query)
  if (cluster === undefined) return undefined
  const asked = Object.entries(databaseQueries("cnpg", `cnpg_io_cluster="${cluster.name}"`)).find(
    ([, each]) => each === query,
  )
  const answers = answersOf(cluster, environment, Date.now() / 1000)
  return asked === undefined ? undefined : (answers[asked[0] as keyof typeof answers] ?? [])
}

/** One number over time for the cnpg preset's stats and the lane's counts. */
export const databaseStat = (environment: Environment, query: string, seconds: number): number | undefined => {
  const cluster = clusterAsked(environment, query)
  if (cluster === undefined) return undefined
  const replicas = cluster.instances.filter((instance) => instance.replica)
  const threshold = Number(/ > (\d+)\)/.exec(query)?.[1] ?? 30)
  const total = connectionsOf(cluster, environment, seconds).reduce((sum, client) => sum + client.connections, 0)
  if (query.includes("cnpg_pg_replication_in_recovery") && query.includes("== 0")) return 1
  if (query.includes("cnpg_pg_replication_in_recovery") && query.includes("== 1")) return replicas.length
  if (query.startsWith("count(cnpg_pg_replication_lag"))
    return replicas.filter((instance) => instance.lag(seconds) > threshold).length
  if (query.includes("cnpg_collector_up")) return 0
  if (query.includes("cnpg_pg_replication_lag"))
    return Math.max(...replicas.map((instance) => instance.lag(seconds)), 0)
  if (query.includes("cnpg_backends_total")) return total
  if (query.includes("xact_commit"))
    return (environment === "production" ? 380 : 6) * shopTrafficOf(environment, seconds)
  if (query.includes("database_size_bytes")) return cluster.databases.reduce((sum, [, size]) => sum + size, 0)
  if (query.includes("last_available_backup")) return 5 * 3600 + since(seconds)
  return undefined
}
