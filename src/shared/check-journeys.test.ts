import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { checkCatalog } from "./check"

const catalog = (journeys: ReadonlyArray<unknown>) => ({
  environments: [{ name: "production", sources: "production" }],
  services: [{ name: "shop", environments: ["production"] }],
  stores: [{ name: "shop-db", environments: ["production"], engine: "postgres", selector: 'job="postgres"' }],
  map: { nodes: [{ id: "web", title: "Browser", kind: "external" }], edges: [] },
  journeys,
})

const mistakes = (input: unknown) => {
  const checked = checkCatalog(input)
  return Result.isFailure(checked) ? checked.failure.map((mistake) => `${mistake.at}: ${mistake.message}`) : []
}

const adoption = {
  name: "adoption",
  environments: ["production"],
  start: { service: "shop-web", span: "adopt pet" },
  stages: [
    { title: "Reaches the shop", where: "web", from: { start: "adopt pet" }, to: { start: "POST /adoptions" } },
    { title: "Decides", where: "shop", span: "adopt" },
    { title: "Waits in the outbox", where: "shop-db", from: { end: "INSERT outbox" }, to: { start: "publish" } },
  ],
}

describe("a journey", () => {
  test("places its stages on the map's nodes, services and stores", () => {
    expect(mistakes(catalog([adoption]))).toEqual([])
  })

  test("names each mistake: its environment, a place it cannot find, and a stage that is neither a span nor a gap", () => {
    expect(
      mistakes(
        catalog([
          {
            ...adoption,
            environments: ["staging"],
            stages: [
              { title: "Lost", where: "nowhere", span: "adopt" },
              { title: "Both", where: "shop", span: "adopt", from: { start: "adopt" }, to: { end: "adopt" } },
              { title: "Half", where: "shop", from: { start: "adopt" } },
            ],
          },
          { ...adoption, stages: [] },
        ]),
      ),
    ).toEqual([
      'journeys: "adoption" is named twice',
      'journeys[0] (adoption).environments: "staging" is not an environment',
      'journeys[0] (adoption).stages[0] (Lost).where: "nowhere" is not a map node, service or store',
      "journeys[0] (adoption).stages[1] (Both): is a span or from one edge to another, not both",
      "journeys[0] (adoption).stages[2] (Half): needs a span, or from: and to:",
      "journeys[1] (adoption).stages: names no stage",
    ])
  })
})
