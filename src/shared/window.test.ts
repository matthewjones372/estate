import { describe, expect, test } from "bun:test"
import { windowOf } from "./window"

describe("a window of time to chart", () => {
  test("is read a step of whole minutes at a time, about 120 points, from before it starts to after it ends", () => {
    const from = Date.parse("2026-10-06T08:00:00Z")
    const to = Date.parse("2026-10-06T10:22:00Z")
    const window = windowOf(from, to)
    expect(window.step).toBe(120)
    expect(window.start * 1000).toBeLessThanOrEqual(from)
    expect(window.end * 1000).toBeGreaterThanOrEqual(to)
    expect((window.end - window.start) % window.step).toBe(0)
    expect((window.end - window.start) / window.step).toBeLessThanOrEqual(121)
    expect(windowOf(from, from + 10 * 60_000).step).toBe(60)
  })
})
