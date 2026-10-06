import { describe, expect, test } from "bun:test"
import type { Catalog } from "../../shared/catalog"
import { catalog, environment, estate } from "../fixture"
import type { SourcedAlert } from "../state"
import { aroundView } from "./around"

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const withStore: Catalog = {
  ...catalog,
  stores: [{ name: "orders-db", environments: ["production"], engine: "postgres", selector: 'db="orders"' }],
  map: {
    nodes: [...(catalog.map?.nodes ?? []).filter((node) => node.id !== "db"), { id: "db", store: "orders-db" }],
    edges: catalog.map?.edges ?? [],
  },
}

const alert = (labels: Record<string, string>): SourcedAlert => ({
  id: "x-1",
  name: "Slow",
  state: "firing",
  severity: "critical",
  startsAt: "2026-10-03T11:00:00Z",
  labels,
})

const firing = (catalog: Catalog, labels: Record<string, string>) =>
  estate({
    catalog,
    environments: {
      staging: environment(),
      production: environment({
        alerts: ok([alert(labels)]),
        deploys: ok({ orders: { version: "main-89", ready: true, at: "2026-10-03T11:20:00Z" } }),
      }),
    },
  })

describe("an alert's brief", () => {
  test("about a store names what calls it, with that service's health, and a change since it fired", () => {
    const brief = aroundView(firing(withStore, { database: "orders-db" }), "production", "x-1")
    expect(brief?.subject).toBe("orders-db")
    expect(brief?.depends.map(({ name, kind, side }) => [name, kind, side])).toEqual([
      ["orders", "service", "called by"],
    ])
    expect(brief?.changed).toEqual([
      { at: "2026-10-03T11:20:00Z", service: "orders", kind: "deploy", text: "main-89 deployed" },
    ])
  })

  test("has nothing around it without a map, and is nothing for an alert that is not there", () => {
    const { map: _, ...unmapped } = withStore
    const brief = aroundView(firing(unmapped, { app: "payments" }), "production", "x-1")
    expect([brief?.subject, brief?.depends, brief?.changed]).toEqual(["payments", [], []])
    expect(aroundView(firing(withStore, {}), "production", "nope")).toBeUndefined()
    expect(aroundView(firing(withStore, {}), "nowhere", "x-1")).toBeUndefined()
  })
})
