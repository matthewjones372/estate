import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import type { Catalog } from "../../shared/catalog"
import { catalog, environment, estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, reply, stubRemote } from "../remote"
import type { Settings } from "../settings"
import { Estate, estateLayer } from "../state"
import { servicesView } from "../views/services"
import { startSources } from "./start"

const keys = ConfigProvider.fromUnknown({ AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "secret" })

const billed: Catalog = {
  ...catalog,
  jobs: [
    {
      name: "nightly",
      environments: ["staging"],
      run: { kubernetes: { namespace: "batch", cronJob: "nightly-export" } },
    },
    { name: "report", environments: ["staging"], run: { ecs: { cluster: "jobs", scheduledTask: "report" } } },
  ],
  agents: [
    {
      name: "triage",
      environments: ["staging"],
      runtime: { kubernetes: { namespace: "ai", workloads: [{ kind: "Deployment", name: "triage" }] } },
    },
  ],
  services: catalog.services.map((service) =>
    service.name === "orders"
      ? { ...service, cost: { tag: "orders-api", budget: { amount: 900, per: "month" as const } } }
      : service.name === "search"
        ? { ...service, cost: { opencost: { namespace: "shop", workload: "search" } } }
        : service,
  ),
}

const configured: Settings = {
  ...settings({ anonymous: { name: "gil", role: "viewer" } }),
  sources: {
    staging: {
      costs: {
        aws: { region: "us-east-1", tag: "service", endpoint: "http://ce.test/" },
        opencost: { url: "http://opencost.test/" },
      },
    },
    production: {},
  },
}

/** OpenCost's allocation by namespace and controller, a month's and a day's. */
const opencost = (call: Call) => {
  if (!call.url.startsWith("http://opencost.test/allocation/compute?")) return undefined
  const month = call.url.includes("window=month")
  return reply({
    code: 200,
    data: [
      {
        "shop/storefront": { properties: { namespace: "shop", controller: "storefront" }, totalCost: month ? 81.5 : 3 },
        "shop/search": { properties: { namespace: "shop", controller: "search" }, totalCost: 40 },
        "orders/orders": { properties: { namespace: "orders", controller: "orders" }, totalCost: 999 },
        "batch/nightly-export": { properties: { namespace: "batch", controller: "nightly-export" }, totalCost: 6 },
        "ai/triage": { properties: { namespace: "ai", controller: "triage" }, totalCost: 12 },
      },
    ],
  })
}

/** Cost Explorer at its endpoint, by the operation each signed call names. */
const costExplorer = (call: Call) => {
  if (call.url !== "http://ce.test/") return undefined
  const operation = call.headers?.["x-amz-target"]?.split(".")[1]
  if (operation === "GetCostAndUsage")
    return reply({
      ResultsByTime: [
        {
          TimePeriod: { Start: "1970-01-01" },
          Groups: [{ Keys: ["service$orders-api"], Metrics: { UnblendedCost: { Amount: "640", Unit: "USD" } } }],
        },
      ],
    })
  if (operation === "GetCostForecast") return reply({ Total: { Amount: "1100", Unit: "USD" } })
  return reply({ Anomalies: [] })
}

describe("an environment's costs", () => {
  test("are read from Cost Explorer, shown on its entries, and a forecast past budget needs someone", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* Effect.forkChild(startSources(configured))
        yield* TestClock.adjust("1 second")
        return yield* SubscriptionRef.get(yield* Estate)
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            estateLayer(
              estate({ catalog: billed, environments: { staging: environment(), production: environment() } }),
            ),
            TestClock.layer(),
            stubRemote((call) => costExplorer(call) ?? opencost(call)),
            platform,
          ),
        ),
        Effect.provideService(ConfigProvider.ConfigProvider, keys),
      ),
    ).then((read) => {
      expect(read.environments["staging"]?.costs.state).toBe("ok")
      const orders = servicesView(read, "staging").services.find((service) => service.name === "orders")
      expect(orders?.cost).toMatchObject({ from: "AWS Cost Explorer", monthToDate: 640, forecast: 1100 })
      expect(orders?.reasons).toContain("forecast $1100 passes its $900 a month")
      expect(read.environments["production"]?.costs.state).toBe("off")
      // storefront has no tag in the bill, so its share comes from OpenCost; orders' bill by tag is preferred.
      const storefront = servicesView(read, "staging").services.find((service) => service.name === "storefront")
      expect(storefront?.cost).toEqual({ from: "OpenCost", currency: "USD", monthToDate: 81.5, yesterday: 3 })
      const costs = read.environments["staging"]?.costs.value ?? {}
      expect([costs["search"]?.monthToDate, costs["nightly"]?.monthToDate, costs["triage"]?.monthToDate]).toEqual([
        40, 6, 12,
      ])
      // A job on ECS runs in no cluster OpenCost sees.
      expect(costs["report"]).toBeUndefined()
    }))
})
