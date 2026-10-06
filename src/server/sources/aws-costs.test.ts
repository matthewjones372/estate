import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { AwsCallError, type AwsJson } from "../aws/json"
import { datesAround, readAwsCosts } from "./aws-costs"

// 6 October 2026, at noon.
const now = Date.UTC(2026, 9, 6, 12)

const day = (start: string, groups: Record<string, number>) => ({
  TimePeriod: { Start: start, End: start },
  Groups: Object.entries(groups).map(([key, amount]) => ({
    Keys: [`service$${key}`],
    Metrics: { UnblendedCost: { Amount: String(amount), Unit: "USD" } },
  })),
})

/** Cost Explorer, answering each operation as it would for a small estate tagged by service. */
const costExplorer =
  (calls: Array<readonly [string, unknown]>): AwsJson =>
  (operation, body) => {
    calls.push([operation, body])
    if (operation === "GetCostAndUsage")
      return Effect.succeed({
        ResultsByTime: [
          day("2026-10-01", { checkout: 100, search: 10 }),
          day("2026-10-05", { checkout: 120, search: 12, "": 50 }),
        ],
      })
    if (operation === "GetCostForecast") return Effect.succeed({ Total: { Amount: "1180.5", Unit: "USD" } })
    return Effect.succeed({
      Anomalies: [
        {
          AnomalyStartDate: "2026-10-04T00:00:00Z",
          DimensionValue: "checkout",
          RootCauses: [{ Service: "EC2 - Other" }],
          Impact: { MaxImpact: 140 },
        },
        {
          AnomalyStartDate: "2026-09-20",
          AnomalyEndDate: "2026-09-22",
          DimensionValue: "search",
          Impact: { MaxImpact: 9 },
        },
      ],
    })
  }

describe("AWS Cost Explorer", () => {
  test("gives each service its month to date and yesterday by tag, a forecast against its budget, and an anomaly", () => {
    const calls: Array<readonly [string, unknown]> = []
    return Effect.runPromise(
      readAwsCosts(
        costExplorer(calls),
        "service",
        [
          { name: "checkout", cost: { budget: { amount: 900, per: "month" } } },
          { name: "search" },
          { name: "storefront-web", cost: { tag: "storefront" } },
        ],
        now,
        "USD",
      ),
    ).then((costs) => {
      expect(costs).toEqual({
        checkout: {
          from: "AWS Cost Explorer",
          currency: "USD",
          monthToDate: 220,
          yesterday: 120,
          forecast: 1180.5,
          budget: { amount: 900, per: "month" },
          anomaly: { since: "2026-10-04", impact: 140, cause: "EC2 - Other" },
        },
        search: { from: "AWS Cost Explorer", currency: "USD", monthToDate: 22, yesterday: 12 },
      })
      expect(calls.map(([operation]) => operation)).toEqual(["GetCostAndUsage", "GetCostForecast", "GetAnomalies"])
      expect(calls[0]?.[1]).toMatchObject({
        TimePeriod: { Start: "2026-10-01", End: "2026-10-06" },
        GroupBy: [{ Type: "TAG", Key: "service" }],
      })
      expect(calls[1]?.[1]).toMatchObject({
        TimePeriod: { Start: "2026-10-06", End: "2026-11-01" },
        Filter: { Tags: { Key: "service", Values: ["checkout"] } },
      })
    })
  })

  test("on the first of a month still reads yesterday, and says why when it cannot answer", () => {
    expect(datesAround(Date.UTC(2026, 10, 1, 9))).toEqual({
      today: "2026-11-01",
      yesterday: "2026-10-31",
      month: "2026-11-01",
      next: "2026-12-01",
    })
    const refusing: AwsJson = () =>
      Effect.fail(new AwsCallError({ type: "AccessDeniedException", message: "is not allowed ce:GetCostAndUsage" }))
    const odd: AwsJson = () => Effect.succeed({ Results: [] })
    return Promise.all([
      Effect.runPromise(Effect.flip(readAwsCosts(refusing, "service", [], now, "USD"))),
      Effect.runPromise(Effect.flip(readAwsCosts(odd, "service", [], now, "USD"))),
    ]).then(([refused, unknown]) =>
      expect([refused.message, unknown.message]).toEqual([
        "Cost Explorer is not allowed ce:GetCostAndUsage",
        "Cost Explorer answered GetCostAndUsage in a shape Estate does not know",
      ]),
    )
  })
})
