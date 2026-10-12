import { describe, expect, test } from "bun:test"
import { budgeted, costOf } from "./ask-cost"

const usage = { input: 2_000, cached: 10_000, output: 1_000 }

describe("what an ask cost", () => {
  test("is priced per million tokens, cached input at its own price, or at input's where none is set", () => {
    expect(costOf(usage, { input: 3, output: 15, cachedInput: 0.3 })).toBeCloseTo(0.024)
    expect(costOf(usage, { input: 3, output: 15 })).toBeCloseTo(0.051)
  })

  test("counts against the day's budget as paid for: cached input at its share of input's price", () => {
    expect(budgeted(usage, { input: 3, output: 15, cachedInput: 0.3 })).toBe(4_000)
    expect(budgeted(usage, { input: 3, output: 15 })).toBe(13_000)
    expect(budgeted(usage, undefined)).toBe(13_000)
  })
})
