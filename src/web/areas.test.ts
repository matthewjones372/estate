import { describe, expect, test } from "bun:test"
import type { CatalogEvent, Health, ServicesEvent } from "../shared/events"
import { areasOf, manyServices, neighboursOf, troubleOf } from "./areas"

const catalogOf = (
  members: Readonly<Record<string, ReadonlyArray<string>>>,
  edges: CatalogEvent["map"]["edges"] = [],
  areas?: number | "never",
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
      ...(areas === undefined ? {} : { areas }),
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

const estate = catalogOf({ Shop: ["storefront", "basket"], Payments: ["orders", "payments", "refunds"] }, [
  { from: "storefront", to: "orders" },
  { from: "basket", to: "orders" },
  { from: "orders", to: "payments" },
  { from: "orders", to: "refunds" },
  { from: "payments", to: "provider" },
])
const flows = [
  { from: "storefront", to: "orders", rate: 46.5, alerting: true },
  { from: "basket", to: "orders", rate: 3, alerting: false },
  { from: "orders", to: "payments", rate: 8.7, alerting: false },
  { from: "orders", to: "refunds", rate: 0.4, alerting: false },
  { from: "payments", to: "provider", rate: 8.7, alerting: false },
]
const healths: Readonly<Record<string, Health>> = {
  storefront: "healthy",
  basket: "healthy",
  orders: "healthy",
  payments: "healthy",
  refunds: "healthy",
}

describe("the map as areas", () => {
  test("is its parts by category in the catalog's order, what needs someone first in each", () => {
    const { areas } = areasOf(estate, servicesOf({ ...healths, refunds: "attention", payments: "critical" }, flows))
    expect(areas.map((area) => [area.title, area.parts.map((part) => part.id), area.needing])).toEqual([
      ["Shop", ["storefront", "basket"], 0],
      ["Payments", ["payments", "refunds", "orders"], 2],
      ["Everything else", ["provider"], 0],
    ])
  })

  test("is one area when the catalog names no categories", () => {
    const { areas } = areasOf(catalogOf({ "-": ["web", "orders"] }), servicesOf({ web: "healthy" }))
    expect(areas.map((area) => [area.title, area.parts.map((part) => [part.id, part.health])])).toEqual([
      [
        undefined,
        [
          ["web", "healthy"],
          ["orders", "unknown"],
          ["provider", "healthy"],
        ],
      ],
    ])
  })

  test("says where traffic meets trouble: the busiest edge into and out of each part that needs someone", () => {
    const { parts, edges } = areasOf(
      estate,
      servicesOf({ ...healths, orders: "attention", payments: "critical" }, flows),
    )
    expect(
      troubleOf(parts, edges).map((row) => [row.before?.part.id, row.before?.rate, row.part.id, row.after?.part.id]),
    ).toEqual([["storefront", 46.5, "orders", "payments"]])
  })

  test("lists what calls a part and what it calls, busiest first", () => {
    const { parts, edges } = areasOf(estate, servicesOf(healths, flows))
    const near = neighboursOf("orders", parts, edges)
    expect(near.callers.map((each) => [each.part.id, each.rate])).toEqual([
      ["storefront", 46.5],
      ["basket", 3],
    ])
    expect(near.callees.map((each) => [each.part.id, each.rate])).toEqual([
      ["payments", 8.7],
      ["refunds", 0.4],
    ])
  })

  test("is Auto's view past `map.areas` services, and never when that is never", () => {
    const many = { Shop: Array.from({ length: 13 }, (_, index) => `shop${index}`) }
    expect([
      manyServices(estate),
      manyServices(catalogOf(many)),
      manyServices(catalogOf(many, [], "never")),
      manyServices(catalogOf({ Shop: ["a", "b", "c"] }, [], 2)),
    ]).toEqual([false, true, false, true])
  })
})
