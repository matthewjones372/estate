import { describe, expect, test } from "bun:test"
import type { Catalog, Store } from "../../shared/catalog"
import { catalog, environment, estate } from "../fixture"
import type { SourcedAlert, StoreReading } from "../state"
import { alertsView } from "./alerts"
import { catalogView } from "./catalog"
import { servicesView } from "./services"
import { storeHealthOf, storeOf } from "./stores"

const ordersDb: Store = {
  name: "orders-db",
  environments: ["staging"],
  engine: "cnpg",
  selector: 'cluster="orders-db"',
  links: { dashboard: "https://grafana.example/d/cnpg?var-cluster={store}&env={env}" },
}
const cache: Store = { name: "cache", environments: ["staging"], engine: "redis", selector: 'instance="cache"' }
const stores = [ordersDb, cache]
const withStores: Catalog = {
  ...catalog,
  stores: [...stores, { name: "ledger", environments: ["production"], engine: "postgres", selector: 'db="ledger"' }],
  map: { nodes: [{ id: "db", store: "orders-db" }], edges: [] },
}

const reading = (key: string, now: number | null): StoreReading => ({
  key,
  title: key,
  series: { now, points: [now] },
})
const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })
const metrics = (readings: Record<string, ReadonlyArray<StoreReading>>) =>
  ok({ services: {}, stores: readings, vitals: [], edges: [], charts: {} })
const alert = (name: string, labels: Record<string, string>, severity = "warning"): SourcedAlert => ({
  id: `${name}-1`,
  name,
  state: "firing",
  severity,
  startsAt: "2026-10-03T11:00:00Z",
  labels,
})

describe("a store's health", () => {
  test("needs attention when a CloudNativePG instance is not ready, saying which", () => {
    const state = environment({
      metrics: metrics({ "orders-db": [reading("connections", 40), reading("down", 1), reading("backup", 3600)] }),
    })
    expect(storeHealthOf(ordersDb, state, stores)).toEqual({
      health: "attention",
      reasons: ["1 instance is not ready"],
    })
  })

  test("is critical while a critical alert about it fires, and healthy when its stats are within bounds", () => {
    const state = environment({
      alerts: ok([alert("PostgresDown", { database: "orders-db" }, "critical")]),
      metrics: metrics({ "orders-db": [reading("connections", 85)], cache: [reading("memory", 50)] }),
    })
    expect(storeHealthOf(ordersDb, state, stores)).toEqual({
      health: "critical",
      reasons: ["PostgresDown is firing", "85% of its connections are in use"],
    })
    expect(storeHealthOf(cache, state, stores)).toEqual({ health: "healthy", reasons: [] })
  })

  test("is unknown until a source answers", () => {
    expect(storeHealthOf(cache, environment(), stores)).toEqual({
      health: "unknown",
      reasons: ["no source has answered"],
    })
  })

  test("takes the alerts labelled with its name", () => {
    expect(storeOf({ store: "cache" }, stores)).toBe("cache")
    expect(storeOf({ instance: "cache", database: "orders-db" }, stores)).toBe("orders-db")
    expect(storeOf({ database: "elsewhere" }, stores)).toBeUndefined()
  })
})

describe("stores in the views", () => {
  const state = estate({
    catalog: withStores,
    environments: {
      staging: environment({
        alerts: ok([alert("RedisMemory", { instance: "cache" })]),
        metrics: metrics({ "orders-db": [reading("down", 2)] }),
      }),
      production: environment(),
    },
  })

  test("the catalog names the environment's stores with their links, and map nodes naming one", () => {
    const view = catalogView(withStores, "staging")
    expect(view.stores).toEqual([
      {
        name: "orders-db",
        engine: "cnpg",
        links: [{ name: "dashboard", url: "https://grafana.example/d/cnpg?var-cluster=orders-db&env=staging" }],
      },
      { name: "cache", engine: "redis", links: [] },
    ])
    expect(view.map.nodes).toEqual([{ id: "db", title: "orders-db", kind: "store", store: "orders-db" }])
    expect(catalogView(catalog, "staging").stores).toBeUndefined()
  })

  test("services carry each store's health and stats, and the environment's worst counts them", () => {
    const view = servicesView(state, "staging")
    expect(view.stores).toEqual([
      {
        name: "orders-db",
        health: "attention",
        reasons: ["2 instances are not ready"],
        stats: [{ title: "down", series: { now: 2, points: [2] } }],
      },
      { name: "cache", health: "attention", reasons: ["RedisMemory is firing"], stats: [] },
    ])
    expect(view.environments.find((each) => each.name === "staging")?.worst).toBe("attention")
  })

  test("an alert about a store says which", () => {
    expect(alertsView(state, "staging", false).alerts[0]?.store).toBe("cache")
  })
})
