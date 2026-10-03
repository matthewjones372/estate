import { describe, expect, test } from "bun:test"
import type { CatalogEvent, Health, ServicesEvent } from "../shared/events"
import { categoryId, drawnOf } from "./drawn"

const catalogOf = (
  members: Readonly<Record<string, ReadonlyArray<string>>>,
  edges: CatalogEvent["map"]["edges"] = [],
): CatalogEvent => {
  const names = Object.entries(members).flatMap(([category, each]) => each.map((name) => [name, category] as const))
  return {
    environment: "production",
    environments: [],
    services: names.map(([name, category]) => ({ name, links: [], ...(category === "-" ? {} : { category }) })),
    vitals: [],
    map: {
      nodes: [
        ...names.map(([name]) => ({ id: name, title: name, kind: "service", service: name })),
        { id: "provider", title: "Card provider", kind: "external" },
      ],
      edges,
    },
  }
}
const servicesOf = (health: Readonly<Record<string, Health>>, edges: ServicesEvent["edges"] = []): ServicesEvent => ({
  sources: [],
  environments: [],
  services: Object.entries(health).map(([name, each]) => ({
    name,
    health: each,
    reasons: [],
    pods: [],
    jobs: [],
    load: {},
  })),
  vitals: [],
  edges,
})

const shop = Array.from({ length: 7 }, (_, index) => `shop${index}`)
const payments = ["orders", "payments", "refunds", "ledger", "fraud", "payouts"]
const big = catalogOf({ Shop: shop, Payments: payments }, [
  { from: "shop0", to: "orders", label: "orders" },
  { from: "shop1", to: "payments" },
  { from: "orders", to: "payments" },
  { from: "payments", to: "provider", label: "charges" },
])
const flows = [
  { from: "shop0", to: "orders", rate: 30, alerting: false },
  { from: "shop1", to: "payments", rate: 12, alerting: true },
  { from: "payments", to: "provider", rate: null, alerting: false },
]

describe("the map drawn", () => {
  test("is every node as the catalog lists it, up to twelve", () => {
    const small = catalogOf({ Shop: ["web"], Payments: ["orders"] }, [{ from: "web", to: "orders", label: "orders" }])
    const drawn = drawnOf(small, servicesOf({}, [{ from: "web", to: "orders", rate: 3, alerting: false }]), new Set())
    expect(drawn.nodes.map((node) => node.id)).toEqual(["web", "orders", "provider"])
    expect(drawn.edges).toEqual([{ from: "web", to: "orders", label: "orders", rate: 3, alerting: false }])
    expect([drawn.closed, drawn.opened]).toEqual([[], []])
  })

  test("past twelve, is a node a category with its count and worst health, and the edges between them summed", () => {
    const drawn = drawnOf(big, servicesOf({ shop0: "healthy", orders: "unknown" }, flows), new Set())
    expect(drawn.nodes).toEqual([
      { id: categoryId("Shop"), kind: "category", title: "Shop", members: 7, beside: 0, health: "unknown" },
      { id: categoryId("Payments"), kind: "category", title: "Payments", members: 6, beside: 0, health: "unknown" },
      { id: "provider", title: "Card provider", kind: "external" },
    ])
    expect(drawn.edges).toEqual([
      { from: categoryId("Shop"), to: categoryId("Payments"), rate: 42, alerting: true },
      { from: categoryId("Payments"), to: "provider", label: "charges", rate: null, alerting: false },
    ])
    expect(drawn.closed).toEqual(["Shop", "Payments"])
  })

  test("opens a category the viewer opened, and draws what needs someone on its own beside its closed category", () => {
    const opened = drawnOf(big, servicesOf({}, flows), new Set(["Payments"]))
    expect(opened.nodes.map((node) => node.id)).toEqual([categoryId("Shop"), ...payments, "provider"])
    expect(opened.edges).toContainEqual({
      from: categoryId("Shop"),
      to: "orders",
      label: "orders",
      rate: 30,
      alerting: false,
    })
    expect([opened.closed, opened.opened]).toEqual([["Shop"], ["Payments"]])
    const urgent = drawnOf(big, servicesOf({ shop3: "critical", shop4: "healthy" }, flows), new Set())
    expect(urgent.nodes.map((node) => node.id)).toEqual([
      categoryId("Shop"),
      "shop3",
      categoryId("Payments"),
      "provider",
    ])
    expect(urgent.nodes[0]).toMatchObject({ members: 6, beside: 1 })
    expect(urgent.closed).toEqual(["Shop", "Payments"])
  })

  test("never collapses when the catalog says never, or names no categories", () => {
    expect(drawnOf(big, undefined, new Set(), "never").nodes).toHaveLength(14)
    expect(drawnOf(catalogOf({ "-": [...shop, ...payments] }), undefined, new Set()).nodes).toHaveLength(14)
  })
})
