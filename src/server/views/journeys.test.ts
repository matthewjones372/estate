import { describe, expect, test } from "bun:test"
import type { Catalog } from "../../shared/catalog"
import { catalogView } from "./catalog"
import { lanesOf, placesOf } from "./journeys"

const catalog: Catalog = {
  environments: [
    { name: "production", sources: "production" },
    { name: "staging", sources: "staging" },
  ],
  services: [
    { name: "shop-web", environments: ["production"] },
    { name: "shop", environments: ["production"] },
  ],
  stores: [{ name: "shop-db", environments: ["production"], engine: "postgres", selector: 'job="postgres"' }],
  map: {
    nodes: [
      { id: "web", service: "shop-web" },
      { id: "db", title: "Postgres", store: "shop-db" },
      { id: "registry", title: "Chip registry", kind: "external" },
    ],
    edges: [],
  },
  journeys: [
    {
      name: "adoption",
      environments: ["production"],
      start: { service: "shop-web", span: "adopt pet" },
      stages: [
        { title: "Decides", where: "shop", span: "adopt" },
        { title: "Checks the chip", where: "registry", span: "GET" },
        { title: "Waits", where: "db", from: { end: "INSERT outbox" }, to: { start: "publish" } },
      ],
    },
  ],
}

describe("a journey in the catalog event", () => {
  test("names the services it crosses, by node or name, in the environments it is in", () => {
    expect(catalogView(catalog, "production").journeys).toEqual([
      {
        name: "adoption",
        title: "adoption",
        services: ["shop-web", "shop"],
        places: [
          { node: "web", stages: [] },
          { node: "registry", stages: [1] },
          { node: "db", stages: [2] },
        ],
      },
    ])
    expect(catalogView(catalog, "staging").journeys).toEqual([])
  })
})

describe("a journey on the map", () => {
  test("is the map's nodes its stages happen in, in order, each with the stages it spends there", () => {
    expect(placesOf(catalog, catalog.journeys?.[0] ?? (undefined as never))).toEqual([
      { node: "web", stages: [] },
      { node: "registry", stages: [1] },
      { node: "db", stages: [2] },
    ])
  })
})

describe("a trace's lanes", () => {
  test("are the map's nodes where it has them, and names where it does not", () => {
    const lanes = lanesOf(catalog)
    expect(lanes.where("registry")).toEqual({ id: "registry", title: "Chip registry" })
    expect(lanes.where("shop-db")).toEqual({ id: "db", title: "Postgres" })
    expect(lanes.where("shop")).toEqual({ id: "shop", title: "shop" })
    expect(lanes.service("shop-web")).toEqual({ id: "web", title: "shop-web" })
  })
})
