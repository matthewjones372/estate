/** A cnpg cluster for the pages' tests: a promoted primary, a replica far behind, one gone, an inactive slot. */
import type { PostgresCluster } from "../shared/postgres-cluster"

const instance = (name: string, role: "primary" | "replica", lag: number | null, connections: number) => ({
  name,
  role,
  lag,
  growing: lag === null ? null : lag > 30 ? 0.4 : 0,
  connections,
  maxConnections: 100,
  waiting: null,
})

export const databaseCluster: PostgresCluster = {
  engine: "postgres",
  readAt: "2026-10-03T11:59:56Z",
  version: "17",
  instances: [
    { ...instance("orders-db-1", "primary", null, 22), promoted: true, waiting: 1 },
    instance("orders-db-2", "replica", 2, 6),
    instance("orders-db-3", "replica", 42, 4),
    {
      name: "orders-db-4",
      role: null,
      gone: 600,
      lag: null,
      growing: null,
      connections: null,
      maxConnections: null,
      waiting: null,
    },
  ],
  databases: [
    { name: "orders", size: 212e6 },
    { name: "postgres", size: 8e6 },
  ],
  clients: [
    { name: "checkout", connections: 18, active: 5, idleInTransaction: 0, longestIdle: null },
    { name: "picking", connections: 4, active: 0, idleInTransaction: 1, longestIdle: 95 },
  ],
  streaming: [
    { name: "orders-db-2", sync: "sync", behind: 0 },
    { name: "orders-db-3", sync: "potential", behind: 1.3e9 },
  ],
  slots: [
    { name: "orders-db-4", active: false, retained: 1.3e9 },
    { name: "orders-db-2", active: true, retained: 0 },
  ],
  archive: { since: 20, failed: 0 },
  backup: 21_600,
  limits: { lag: 30, connections: 80 },
  missing: [],
}

/** One postgres_exporter instance, with none of the optional collectors. */
export const loneDatabase: PostgresCluster = {
  ...databaseCluster,
  version: null,
  instances: [{ ...instance("db:9187", "primary", null, 9), maxConnections: 200 }],
  databases: [{ name: "shop", size: 40e6 }],
  clients: [],
  streaming: [],
  slots: [],
  archive: null,
  backup: null,
  missing: ["clients need postgres_exporter's stat_activity collector"],
}
