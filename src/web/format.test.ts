import { describe, expect, test } from "bun:test"
import { shape } from "./chart"
import { amount, counted, duration, initials, measured, since } from "./format"

describe("the page's words", () => {
  test("durations read as a person would say them", () => {
    expect(duration(20_000)).toBe("under a minute")
    expect(duration(14 * 60_000)).toBe("14 min")
    expect(duration(120 * 60_000)).toBe("2 h")
    expect(duration(112 * 60_000)).toBe("1 h 52 min")
    expect(duration(72 * 3_600_000)).toBe("3 d")
    expect(since("2026-10-03T10:00:00Z", Date.parse("2026-10-03T10:08:00Z"))).toBe("8 min")
  })

  test("amounts keep few digits", () => {
    expect(amount(1250.4)).toBe("1,250")
    expect(amount(148)).toBe("148")
    expect(amount(12.04)).toBe("12")
    expect(amount(9.44)).toBe("9.44")
    expect(amount(0.03)).toBe("0.03")
    expect(amount(0)).toBe("0")
    expect(amount(0.0004)).toBe("4.0e-4")
    expect(amount(null)).toBe("–")
  })

  test("units are written the usual way", () => {
    expect(measured(0.212, "s")).toBe("212 ms")
    expect(measured(2.5, "s")).toBe("2.5 s")
    expect(measured(148, "/s")).toBe("148/s")
    expect(measured(3, "events")).toBe("3 events")
    expect(measured(3, undefined)).toBe("3")
    expect(measured(null, "/s")).toBe("–")
    expect(measured(1536, "bytes")).toBe("1.5 KiB")
    expect(measured(3 * 1024 ** 3, "bytes")).toBe("3 GiB")
    expect(measured(512, "bytes")).toBe("512 B")
    expect(measured(1, "cores")).toBe("1 core")
    expect(measured(0.25, "cores")).toBe("0.25 cores")
    expect(measured(42.5, "%")).toBe("42.5%")
  })

  test("counts are words up to twelve", () => {
    expect(counted(0, "thing")).toBe("No things")
    expect(counted(1, "thing")).toBe("One thing")
    expect(counted(2, "thing")).toBe("Two things")
    expect(counted(14, "thing")).toBe("14 things")
  })

  test("initials come from the name's words", () => {
    expect(initials("ada lovelace")).toBe("AL")
    expect(initials("gil")).toBe("GI")
  })
})

describe("a chart's shape", () => {
  test("spans the box, lowest at the bottom and highest at the top", () => {
    const drawn = shape([0, 5, 10], 100, 20, { pad: 0 })
    expect(drawn.line).toBe("0.0,20 50.0,10 100.0,0")
    expect(drawn.area).toBe("0.0,20 0.0,20 50.0,10 100.0,0 100.0,20")
    expect(drawn.y(5)).toBe(10)
  })

  test("leaves out what is missing, and draws nothing from nothing", () => {
    expect(shape([null, 4, null, 8], 30, 10, { pad: 0, low: 0, high: 8 }).line).toBe("10.0,5 30.0,0")
    expect(shape([null, null], 30, 10).area).toBe("")
  })
})
