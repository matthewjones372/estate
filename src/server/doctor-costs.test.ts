import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import type { Catalog } from "../shared/catalog"
import { doctor, printed } from "./doctor"
import { settings } from "./fixture"
import { platform } from "./platform"
import { type Call, reply, stubRemote } from "./remote"
import type { Settings } from "./settings"

const catalog: Catalog = {
  environments: [
    { name: "shared", sources: "shared" },
    { name: "untagged", sources: "untagged" },
    { name: "down", sources: "down" },
  ],
  services: [
    {
      name: "web",
      environments: ["shared", "untagged", "down"],
      kubernetes: { namespace: "shop", workloads: [{ kind: "Deployment", name: "web" }] },
    },
  ],
}

const configured: Settings = {
  ...settings(),
  sources: {
    shared: { costs: { opencost: { url: "http://opencost/" } } },
    untagged: { costs: { opencost: { url: "http://empty/" } } },
    down: { costs: { anthropic: { adminKey: Redacted.make("k"), url: "http://down/" } } },
  },
}

const answer = (call: Call) => {
  if (call.url.startsWith("http://opencost/"))
    return reply({ data: [{ web: { properties: { namespace: "shop", controller: "web" }, totalCost: 12 } }] })
  if (call.url.startsWith("http://empty/")) return reply({ data: [] })
  return reply("no", 401)
}

describe("estate doctor", () => {
  test("reads each environment's cost tools and says what each entry costs, or why it cannot", () =>
    Effect.runPromise(doctor(configured, catalog).pipe(Effect.provide(Layer.merge(stubRemote(answer), platform)))).then(
      (reports) => {
        const { text } = printed(reports)
        expect(text).toContain("costs    ok    web $12.00 this month (OpenCost)")
        expect(text).toContain("every    ok    alerts 20s, metrics 30s, cluster 15s, deploys 30s, costs 6h")
        expect(text).toContain("costs    ok    web $0.00 this month (OpenCost)")
        // No agent here bills to Anthropic, so its report is not asked for.
        expect(text).toContain("costs    ok    nothing in this environment is in the bill")
      },
    ))
})
