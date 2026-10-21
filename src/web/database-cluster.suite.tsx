/** @jsxImportSource solid-js */
/** A database store's cluster on its page, in happy-dom: run by `database-cluster.test.ts`. */
import { describe, expect, test } from "bun:test"
import type { Events } from "../shared/events"
import { databaseWrong } from "./database"
import { events } from "./fixture"
import { databaseCluster, loneDatabase } from "./fixture-database"
import { mount } from "./harness"
import { StorePage } from "./pages/Store"

const withDatabases: Events = {
  ...events,
  catalog: {
    ...events.catalog,
    stores: [
      { name: "orders-db", engine: "cnpg", links: [] },
      { name: "shop-db", engine: "postgres", links: [] },
      { name: "quiet-db", engine: "postgres", links: [] },
      { name: "cache", engine: "redis", links: [] },
    ],
  },
}

const opened = async (store = "orders-db") => {
  const page = mount(() => <StorePage name={store} />, { sent: withDatabases })
  await page.settle()
  return page
}

const seen = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim()

describe("a database store's cluster", () => {
  test("says what is wrong in a sentence, and that all is well when it is", () => {
    expect(databaseWrong(databaseCluster)).toBe(
      "orders-db-4 has been gone 10 min; orders-db-3 is 42 s behind the primary and falling further; slot orders-db-4 is inactive and holds 1.21 GiB of WAL; picking has been idle in a transaction for 95 s.",
    )
    expect(databaseWrong(loneDatabase)).toBe("Every instance is up, and nothing is behind or held.")
  })

  test("draws its instances as columns, the primary first and promoted, the replica behind amber, one gone", async () => {
    const page = await opened()
    expect(page.calls).toContainEqual(["databaseCluster", "orders-db"])
    const columns = [...page.container.querySelectorAll(".kafka-broker")]
    expect(
      columns.map((column) => [column.className, seen(column.querySelector("h4")), seen(column.querySelector("p"))]),
    ).toEqual([
      ["kafka-broker primary", "orders-db-1", "primary · promoted in the last hour"],
      ["kafka-broker", "orders-db-2", "replica · 2 s behind"],
      ["kafka-broker attention", "orders-db-3", "replica · 42 s behind ▲"],
      ["kafka-broker gone", "orders-db-4", "gone 10 min"],
    ])
    expect([...(columns[0]?.querySelectorAll(".database-sizes .kafka-chip") ?? [])].map(seen)).toEqual([
      "orders 202 MiB",
      "postgres 7.63 MiB",
    ])
    const meter = columns[0]?.querySelector("meter")
    expect([meter?.getAttribute("value"), meter?.getAttribute("max"), meter?.getAttribute("aria-label")]).toEqual([
      "22",
      "100",
      "22 of 100 connections",
    ])
    expect(page.container.textContent).toContain("3 instances up · 2 databases · Postgres 17 · read")
    page.dispose()
  })

  test("names the clients on the left, one idle in a transaction called out", async () => {
    const page = await opened()
    const clients = [...page.container.querySelectorAll(".kafka-in .kafka-card")]
    expect(clients.map(seen)).toEqual([
      "checkout 18 connections · 5 active",
      "picking 4 connections · 0 active idle in a transaction for 95 s",
    ])
    expect(clients[1]?.classList.contains("attention")).toBe(true)
    page.dispose()
  })

  test("shows where its WAL goes on the right, the inactive slot amber", async () => {
    const page = await opened()
    const targets = [...page.container.querySelectorAll(".kafka-out .kafka-card")]
    expect(targets.map(seen)).toEqual([
      "orders-db-2 streaming · sync · 0 B to replay",
      "orders-db-3 streaming · potential · 1.21 GiB to replay",
      "slot orders-db-4 inactive · holds 1.21 GiB",
      "slot orders-db-2 active · holds 0 B",
      "WAL archive last segment 20 s ago",
      "Base backup 6 h ago",
    ])
    expect(targets.map((target) => target.classList.contains("attention"))).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
    ])
    expect(page.container.querySelector(".kafka-panel")).not.toBeNull()
    page.dispose()
  })

  test("of one instance draws one column, and says which parts its exporter does not publish", async () => {
    const page = await opened("shop-db")
    expect(page.container.querySelectorAll(".kafka-broker")).toHaveLength(1)
    expect(page.container.textContent).toContain("Clients need postgres_exporter's stat_activity collector.")
    expect(page.container.textContent).toContain("Nothing reported")
    page.dispose()
  })

  test("says why it is not drawn, and is not there for a store whose cluster is not drawn", async () => {
    const quiet = await opened("quiet-db")
    expect(quiet.container.textContent).toContain("the exporter publishes nothing for quiet-db")
    quiet.dispose()
    const cache = await opened("cache")
    expect(cache.calls.some(([name]) => name === "databaseCluster")).toBe(false)
    cache.dispose()
  })
})
