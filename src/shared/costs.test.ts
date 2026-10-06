import { describe, expect, test } from "bun:test"
import { costLine, costReasons } from "./costs"

describe("an entry's cost", () => {
  test("needs someone for an anomaly, a forecast past its monthly budget, or a day past its daily one", () => {
    expect(
      costReasons({
        from: "AWS Cost Explorer",
        currency: "USD",
        forecast: 1180.5,
        budget: { amount: 900, per: "month" },
        anomaly: { since: "2026-10-04", impact: 140, cause: "EC2 - Other" },
      }),
    ).toEqual(["cost anomaly: +$140 a day since 2026-10-04 (EC2 - Other)", "forecast $1,181 passes its $900 a month"])
    expect(
      costReasons({ from: "Anthropic", currency: "EUR", yesterday: 52.5, budget: { amount: 40, per: "day" } }),
    ).toEqual(["spent €52.50 yesterday, over its €40.00 a day"])
    expect(
      costReasons({
        from: "Anthropic",
        currency: "USD",
        budget: { amount: 40, per: "day" },
        estimate: { lastHour: 4.2, atThisRate: 100.8 },
        anomaly: { since: "2026-10-05", impact: 12 },
      }),
    ).toEqual(["cost anomaly: +$12.00 a day since 2026-10-05", "will pass its $40.00 today at this rate (est.)"])
  })

  test("needs no one within its budget, or with none to read", () => {
    expect(costReasons(undefined)).toEqual([])
    expect(costReasons({ from: "OpenCost", currency: "USD", monthToDate: 12, forecast: 30 })).toEqual([])
  })
})

describe("an entry's cost in a line", () => {
  test("is the bill against its budget, then the estimate, which says it is one", () => {
    expect(
      costLine({
        from: "AWS Cost Explorer",
        currency: "USD",
        monthToDate: 612.4,
        forecast: 880,
        budget: { amount: 900, per: "month" },
      }),
    ).toBe("$612 this month (forecast $880 of $900)")
    expect(
      costLine({
        from: "Anthropic",
        currency: "GBP",
        yesterday: 31,
        monthToDate: 100,
        budget: { amount: 40, per: "day" },
        estimate: { lastHour: 4.2, atThisRate: 100.8 },
      }),
    ).toBe("£31.00 yesterday of £40.00 a day · est. £4.20 in the last hour")
    expect(costLine({ from: "OpenCost", currency: "CHF", monthToDate: 12, forecast: 30 })).toBe(
      "CHF 12.00 this month (forecast CHF 30.00)",
    )
    expect(costLine({ from: "Estate's estimate", currency: "USD", estimate: { lastHour: 0.5, atThisRate: 12 } })).toBe(
      "est. $0.50 in the last hour",
    )
    expect(costLine(undefined)).toBe("")
  })
})
