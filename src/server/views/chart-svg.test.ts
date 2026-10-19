import { describe, expect, test } from "bun:test"
import { chartSvg } from "./chart-svg"

const start = Date.parse("2026-10-12T16:00:00Z") / 1000
const window = { start, end: start + 120, step: 60 }
const chart = { service: "orders", environment: "staging", panel: "errors", query: "q", points: [0.5, 2.25, null] }
const texts = (svg: string) =>
  [...svg.matchAll(/<text class="(\w+)"[^>]*>([^<]*)<\/text>/g)].map((each) => each.slice(1))

describe("a kept chart drawn for the export", () => {
  test("says its unit, its highest with when, and the window's ends in UTC", () => {
    const svg = chartSvg(chart, window, { from: start * 1000, to: (start + 60) * 1000 }, [])
    expect(texts(svg)).toEqual([
      ["title", "orders errors (/s), staging"],
      ["high", "highest 2.25/s at 16:01 UTC"],
      ["axis", "12 Oct 16:00 UTC"],
      ["axis", "12 Oct 16:02 UTC"],
    ])
  })

  test("says when the source had nothing to draw", () => {
    const svg = chartSvg({ ...chart, points: [null, null] }, window, { from: 0, to: 0 }, [])
    expect(texts(svg)).toContainEqual(["high", "no points"])
  })
})
