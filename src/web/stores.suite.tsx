/** @jsxImportSource solid-js */
/** Stores on the page, in happy-dom: run by \`stores.test.ts\` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Events } from "../shared/events"
import { App } from "./App"
import { events, heard, now, operator, series } from "./fixture"
import { mount, render } from "./harness"
import { headlineOf, Overview } from "./pages/Overview"
import { StorePage } from "./pages/Store"
import { recording } from "./recording"

const withStores: Events = {
  ...events,
  catalog: {
    ...events.catalog,
    stores: [
      {
        name: "orders-db",
        description: "The orders database",
        engine: "cnpg",
        links: [{ name: "dashboard", url: "https://grafana.example/d/cnpg" }],
      },
      { name: "cache", engine: "redis", links: [] },
    ],
    map: {
      nodes: [
        ...events.catalog.map.nodes.filter((node) => node.id !== "db"),
        { id: "db", title: "orders-db", kind: "store", store: "orders-db" },
      ],
      edges: events.catalog.map.edges,
    },
  },
  services: {
    ...events.services,
    stores: [
      {
        name: "orders-db",
        health: "attention",
        reasons: ["1 instance is not ready", "no backup for 30 h"],
        stats: [
          { title: "Connections used", unit: "%", series: series([40, 45]) },
          { title: "Instances not ready", series: series([0, 1]) },
        ],
      },
    ],
  },
  alerts: {
    ...events.alerts,
    alerts: [
      ...events.alerts.alerts,
      {
        id: "s1",
        name: "BackupMissing",
        state: "firing",
        severity: "warning",
        store: "orders-db",
        startsAt: "2026-10-03T11:00:00Z",
        labels: { alertname: "BackupMissing", database: "orders-db" },
        notes: [],
      },
    ],
    resolved: [
      {
        alert: "a8",
        name: "ReplicaLag",
        store: "orders-db",
        startsAt: "2026-10-03T08:00:00Z",
        endsAt: "2026-10-03T08:30:00Z",
      },
    ],
  },
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("stores on the overview", () => {
  test("have a lane each after the services: health and why, stats, links", () => {
    const page = text(render(() => <Overview />, { sent: withStores }))
    expect(page).toContain("Stores")
    expect(page).toContain("orders-db Degraded 1 instance is not ready +1 cnpg")
    expect(page).toContain("Connections used")
    expect(page).toContain("cache Unknown")
    expect(text(render(() => <Overview />))).not.toContain("Stores")
  })

  test("count in the headline when they need someone", () => {
    expect(headlineOf(withStores).lede).toContain("orders-db: 1 instance is not ready")
  })

  test("colour their map node by health, and link it to the store", () => {
    const html = render(() => <Overview />, { sent: withStores })
    expect(html).toMatch(/<a[^>]*href="\/stores\/orders-db"[^>]*class="map-node attention"/)
  })
})

describe("a store's page", () => {
  test("says its health and every reason, its engine, its links and what fires about it", () => {
    const page = text(render(() => <StorePage name="orders-db" />, { sent: withStores }))
    expect(page).toContain("1 instance is not ready")
    expect(page).toContain("no backup for 30 h")
    expect(page).toContain("The orders database · cnpg")
    expect(page).toContain("Dashboard")
    expect(page).toContain("BackupMissing")
    expect(page).toContain("ReplicaLag")
    expect(page).toContain("Instances not ready")
  })

  test("reads its stats again for a longer range", async () => {
    const page = mount(() => <StorePage name="orders-db" />, { sent: withStores })
    page.click(page.button("24h"))
    await page.settle()
    expect(page.calls).toContainEqual(["storeLoad", "orders-db", "24h"])
    expect(page.container.textContent).toContain("45%")
    page.dispose()
  })

  test("says when the store is not here, and draws without readings", () => {
    expect(text(render(() => <StorePage name="ledger" />, { sent: withStores }))).toContain("ledger is not in")
    expect(text(render(() => <StorePage name="cache" />, { sent: withStores }))).toContain("Nothing firing.")
  })

  test("is the page the address names", () => {
    const { actions } = recording()
    const estate = { live: heard(withStores), me: operator, actions, now: () => now }
    const page = () => ({ page: "store" as const, name: "orders-db" })
    expect(text(render(() => <App estate={{ ...estate, page }} />))).toContain("Alerts about it")
  })
})
