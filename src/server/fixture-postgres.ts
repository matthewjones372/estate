/** A cnpg cluster's and a lone postgres_exporter's series for the server's tests: a Prometheus stub of instant queries. */
import { type DatabaseReadings, databaseQueries } from "../shared/postgres-cluster"
import { type Call, reply } from "./remote"

type Series = { readonly metric: Record<string, string>; readonly value: [number, string] }
const series = (metric: Record<string, string>, value: number): Series => ({ metric, value: [0, String(value)] })
const pod = (name: string, value: number, more: Record<string, string> = {}) => series({ pod: name, ...more }, value)

/**
 * orders-db: orders-db-1 the primary, promoted within the hour; orders-db-2 a replica 2 s behind; orders-db-3 42 s
 * behind and falling further; orders-db-4 gone ten minutes, its slot inactive and holding 1.3 GB of WAL; picking
 * idle in a transaction for a minute and a half.
 */
const cnpg = (now: number): Readonly<Partial<Record<keyof DatabaseReadings, ReadonlyArray<Series>>>> => ({
  seen: [
    pod("orders-db-1", now - 20),
    pod("orders-db-2", now - 20),
    pod("orders-db-3", now - 20),
    pod("orders-db-4", now - 600),
  ],
  recovery: [pod("orders-db-1", 0), pod("orders-db-2", 1), pod("orders-db-3", 1)],
  wasReplica: [pod("orders-db-1", 1), pod("orders-db-2", 1), pod("orders-db-3", 1)],
  lag: [pod("orders-db-1", 0), pod("orders-db-2", 2), pod("orders-db-3", 42)],
  growing: [pod("orders-db-2", 0), pod("orders-db-3", 0.4)],
  connections: [pod("orders-db-1", 22), pod("orders-db-2", 6), pod("orders-db-3", 4)],
  maxConnections: [pod("orders-db-1", 100), pod("orders-db-2", 100), pod("orders-db-3", 100)],
  waiting: [pod("orders-db-1", 1)],
  databases: [
    pod("orders-db-1", 212e6, { datname: "orders" }),
    pod("orders-db-1", 8e6, { datname: "postgres" }),
    pod("orders-db-3", 210e6, { datname: "orders" }),
  ],
  clients: [
    series({ application_name: "checkout", state: "active" }, 5),
    series({ application_name: "checkout", state: "idle" }, 13),
    series({ application_name: "picking", state: "idle in transaction" }, 1),
    series({ application_name: "picking", state: "idle" }, 3),
    series({ application_name: "", state: "active" }, 1),
  ],
  idle: [series({ application_name: "picking" }, 95)],
  streaming: [
    series({ application_name: "orders-db-2", sync_state: "sync" }, 0),
    series({ application_name: "orders-db-3", sync_state: "potential" }, 1.3e9),
  ],
  slotActive: [series({ slot_name: "orders-db-2" }, 1), series({ slot_name: "orders-db-4" }, 0)],
  slotRetained: [series({ slot_name: "orders-db-2" }, 0), series({ slot_name: "orders-db-4" }, 1.3e9)],
  archiveSince: [series({}, 20)],
  archiveFailed: [series({}, 0)],
  backup: [series({}, 6 * 3600)],
  version: [series({ full: "17.4", major: "17" }, 1)],
})

/** db: one postgres_exporter target, the primary, with no replicas and none of the optional collectors. */
const lone = (now: number): Readonly<Partial<Record<keyof DatabaseReadings, ReadonlyArray<Series>>>> => ({
  seen: [series({ instance: "db:9187" }, now - 15)],
  recovery: [series({ instance: "db:9187" }, 0)],
  connections: [series({ instance: "db:9187" }, 9)],
  maxConnections: [series({ instance: "db:9187" }, 200)],
  databases: [series({ instance: "db:9187", datname: "shop" }, 40e6)],
})

const answered = (engine: "cnpg" | "postgres", selector: string, answers: ReturnType<typeof cnpg>) =>
  new Map(
    Object.entries(databaseQueries(engine, selector)).map(([key, query]) => [
      query,
      answers[key as keyof DatabaseReadings] ?? [],
    ]),
  )

export const databaseExporter = (now: number) => {
  const known = new Map([
    ...answered("cnpg", 'cnpg_io_cluster="orders-db"', cnpg(now)),
    ...answered("postgres", 'job="postgres"', lone(now)),
  ])
  return (call: Call) => {
    const url = new URL(call.url)
    if (url.pathname !== "/api/v1/query") return undefined
    return reply({ data: { result: known.get(url.searchParams.get("query") ?? "") ?? [] } })
  }
}
