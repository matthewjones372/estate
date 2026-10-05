import { describe, expect, test } from "bun:test"
import type { CatalogEvent } from "../shared/events"
import { jumpHits, jumpRecent, recentHits, withHealth } from "./jump"

const catalog = {
  environment: "production",
  environments: [{ name: "production", title: "Production" }],
  services: [
    { name: "storefront", category: "Shop", links: [] },
    { name: "payments-nightly", category: "Payments", links: [] },
    { name: "orders", links: [] },
  ],
  stores: [
    { name: "orders-db", engine: "cnpg", links: [] },
    { name: "cache", engine: "redis", links: [] },
  ],
  jobs: [
    { name: "nightly-settlement", kind: "CronJob" as const, links: [] },
    { name: "export", kind: "ScheduledTask" as const, links: [] },
  ],
  agents: [
    { name: "support-triage", category: "Shop", links: [] },
    { name: "nightly-summariser", links: [] },
  ],
  vitals: [],
  map: { nodes: [], edges: [] },
} satisfies CatalogEvent

describe("jumpHits", () => {
  test("is nothing for an empty query or a missing catalog", () => {
    expect(jumpHits(catalog, "")).toEqual([])
    expect(jumpHits(catalog, "   ")).toEqual([])
    expect(jumpHits(undefined, "storefront")).toEqual([])
  })

  test("matches case-insensitively and puts exact and prefix before mid-string", () => {
    expect(jumpHits(catalog, "STOREFRONT").map((hit) => hit.name)).toEqual(["storefront"])
    expect(jumpHits(catalog, "order").map((hit) => [hit.kind, hit.name])).toEqual([
      ["service", "orders"],
      ["store", "orders-db"],
    ])
    expect(jumpHits(catalog, "db").map((hit) => hit.name)).toEqual(["orders-db"])
  })

  test("a prefix job beats a mid-string service when kinds differ", () => {
    const hits = jumpHits(catalog, "nightly")
    expect(hits[0]).toMatchObject({ kind: "job", name: "nightly-settlement", path: "/jobs/nightly-settlement" })
    expect(hits.map((hit) => hit.name)).toContain("payments-nightly")
    expect(hits.map((hit) => hit.name)).toContain("nightly-summariser")
    expect(hits.findIndex((hit) => hit.name === "nightly-settlement")).toBeLessThan(
      hits.findIndex((hit) => hit.name === "payments-nightly"),
    )
  })

  test("paths and hints cover every kind", () => {
    expect(jumpHits(catalog, "orders-db")[0]).toMatchObject({
      kind: "store",
      hint: "cnpg",
      path: "/stores/orders-db",
    })
    expect(jumpHits(catalog, "nightly-settlement")[0]).toMatchObject({
      kind: "job",
      hint: "CronJob",
      path: "/jobs/nightly-settlement",
    })
    expect(jumpHits(catalog, "support-triage")[0]).toMatchObject({
      kind: "agent",
      path: "/agents/support-triage",
      hint: "Shop",
    })
    expect(jumpHits(catalog, "storefront")[0]).toMatchObject({
      kind: "service",
      path: "/services/storefront",
      hint: "Shop",
    })
  })

  test("returns at most twenty hits", () => {
    const many = {
      ...catalog,
      services: Array.from({ length: 21 }, (_, index) => ({ name: `svc-${index}`, links: [] })),
      stores: [],
      jobs: [],
      agents: [],
    }
    expect(jumpHits(many, "svc-")).toHaveLength(20)
  })
})

describe("recent jumps", () => {
  test("keep the newest eight that are still in the catalog", () => {
    const held: JumpHitLike[] = [
      { kind: "service", name: "gone", path: "/services/gone" },
      { kind: "service", name: "storefront", path: "/services/storefront" },
      { kind: "job", name: "nightly-settlement", path: "/jobs/nightly-settlement" },
    ]
    expect(recentHits(catalog, held).map((hit) => hit.name)).toEqual(["storefront", "nightly-settlement"])
    const many = Array.from({ length: 10 }, (_, index) => ({
      kind: "service" as const,
      name: "storefront",
      path: `/services/storefront-${index}`,
    }))
    expect(recentHits(catalog, many)).toHaveLength(8)
  })

  test("are written and read through kept storage", () => {
    const held = new Map<string, string>()
    const storage = {
      read: () => held.get(jumpRecent.key) ?? null,
      write: (value: string) => held.set(jumpRecent.key, value),
    }
    jumpRecent.write(storage.write, [{ kind: "store", name: "orders-db", path: "/stores/orders-db", hint: "cnpg" }])
    expect(jumpRecent.read(storage.read)).toEqual([
      { kind: "store", name: "orders-db", path: "/stores/orders-db", hint: "cnpg" },
    ])
    expect(jumpRecent.read(() => "not-json")).toEqual([])
  })
})

describe("withHealth", () => {
  test("adds the environment's health when known", () => {
    const hits = jumpHits(catalog, "storefront")
    expect(withHealth(hits, { services: [{ name: "storefront", health: "attention" }] })[0]?.health).toBe("attention")
    expect(withHealth(hits, undefined)[0]?.health).toBeUndefined()
  })
})

type JumpHitLike = { kind: "service" | "store" | "job" | "agent"; name: string; path: string }
