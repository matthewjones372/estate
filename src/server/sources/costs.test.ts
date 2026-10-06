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
  services: catalog.services.map((service) =>
    service.name === "orders"
      ? { ...service, cost: { tag: "orders-api", budget: { amount: 900, per: "month" as const } } }
      : service,
  ),
}

const configured: Settings = {
  ...settings({ anonymous: { name: "gil", role: "viewer" } }),
  sources: {
    staging: { costs: { aws: { region: "us-east-1", tag: "service", endpoint: "http://ce.test/" } } },
    production: {},
  },
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
            stubRemote(costExplorer),
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
    }))
})
