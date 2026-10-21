import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Catalog, Store } from "../../shared/catalog"
import type { PostgresCluster } from "../../shared/postgres-cluster"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import { databaseExporter } from "../fixture-postgres"
import { reply } from "../remote"
import type { Settings } from "../settings"

const ordersDb: Store = {
  name: "orders-db",
  environments: ["staging"],
  engine: "cnpg",
  selector: 'cnpg_io_cluster="orders-db"',
  attention: { lag: 20 },
}
const lone: Store = { name: "shop-db", environments: ["staging"], engine: "postgres", selector: 'job="postgres"' }
const withDatabases: Catalog = { ...catalog, stores: [ordersDb, lone] }
const metered: Settings = {
  ...settings({ anonymous: { name: "visitor", role: "viewer" } }),
  sources: { staging: { prometheus: { url: "http://prometheus" } } },
}

const asked = (path: string, answer = databaseExporter(Date.now() / 1000)) =>
  Effect.flatMap(serverFor(metered, estate({ catalog: withDatabases }), answer), (server) =>
    ask(server, new Request(`http://estate${path}`)),
  )

describe("a database store's cluster", () => {
  test("is its instances, the primary first and promoted, a replica past its threshold, and one gone", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cluster = (yield* asked("/api/store-cluster?env=staging&store=orders-db")).json() as PostgresCluster
        expect([cluster.engine, cluster.version, cluster.limits]).toEqual([
          "postgres",
          "17",
          { lag: 20, connections: 80 },
        ])
        expect(cluster.instances).toEqual([
          {
            name: "orders-db-1",
            role: "primary",
            promoted: true,
            lag: null,
            growing: null,
            connections: 22,
            maxConnections: 100,
            waiting: 1,
          },
          {
            name: "orders-db-2",
            role: "replica",
            lag: 2,
            growing: 0,
            connections: 6,
            maxConnections: 100,
            waiting: null,
          },
          {
            name: "orders-db-3",
            role: "replica",
            lag: 42,
            growing: 0.4,
            connections: 4,
            maxConnections: 100,
            waiting: null,
          },
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
        ])
        expect(cluster.databases).toEqual([
          { name: "orders", size: 212e6 },
          { name: "postgres", size: 8e6 },
        ])
      }),
    ))

  test("names its clients, one idle in a transaction, and where its WAL goes, an inactive slot holding it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cluster = (yield* asked("/api/store-cluster?env=staging&store=orders-db")).json() as PostgresCluster
        expect(cluster.clients).toEqual([
          { name: "checkout", connections: 18, active: 5, idleInTransaction: 0, longestIdle: null },
          { name: "picking", connections: 4, active: 0, idleInTransaction: 1, longestIdle: 95 },
          { name: "(no name)", connections: 1, active: 1, idleInTransaction: 0, longestIdle: null },
        ])
        expect(cluster.streaming).toEqual([
          { name: "orders-db-2", sync: "sync", behind: 0 },
          { name: "orders-db-3", sync: "potential", behind: 1.3e9 },
        ])
        expect(cluster.slots).toEqual([
          { name: "orders-db-4", active: false, retained: 1.3e9 },
          { name: "orders-db-2", active: true, retained: 0 },
        ])
        expect([cluster.archive, cluster.backup, cluster.missing]).toEqual([{ since: 20, failed: 0 }, 21_600, []])
      }),
    ))

  test("of one instance is one primary, saying which parts its exporter does not publish", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const cluster = (yield* asked("/api/store-cluster?env=staging&store=shop-db")).json() as PostgresCluster
        expect(cluster.instances.map((each) => [each.name, each.role, each.connections])).toEqual([
          ["db:9187", "primary", 9],
        ])
        expect([cluster.streaming, cluster.slots, cluster.archive, cluster.backup]).toEqual([[], [], null, null])
        expect(cluster.missing).toEqual([
          "clients need postgres_exporter's stat_activity collector",
          "the archive needs postgres_exporter's stat_archiver collector",
          "base backups are not in postgres_exporter's series",
        ])
      }),
    ))

  test("is still drawn when a series fails, saying which part it lacks", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answer = databaseExporter(Date.now() / 1000)
        const answered = yield* asked("/api/store-cluster?env=staging&store=orders-db", (call) =>
          new URL(call.url).searchParams.get("query")?.includes("cnpg_backends_total{")
            ? reply({ error: "down" }, 503)
            : answer(call),
        )
        const cluster = answered.json() as PostgresCluster
        expect([answered.status, cluster.instances.length, cluster.clients]).toEqual([200, 4, []])
        expect(cluster.missing).toEqual(["clients need cnpg's backends query"])
      }),
    ))

  test("is a 404 naming why when its exporter publishes nothing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const silent = yield* asked("/api/store-cluster?env=staging&store=orders-db", () =>
          reply({ data: { result: [] } }),
        )
        expect([silent.status, silent.json()]).toEqual([
          404,
          {
            message:
              'the exporter publishes nothing for orders-db: no max_over_time(timestamp(cnpg_collector_up{cnpg_io_cluster="orders-db"})[1h:1m])',
          },
        ])
      }),
    ))
})
