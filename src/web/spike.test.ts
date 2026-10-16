import { afterAll, describe, expect, test } from "bun:test"
import { inBrowser } from "./dom"
import { spikes } from "./spike"

const hour = 3_600_000

/** One point a minute for an hour. */
const minutes = (fill: (minute: number) => number | null) => Array.from({ length: 61 }, (_, minute) => fill(minute))

describe("a spike on a request rate", () => {
  test("a jump above 100 a second, to more than ten times five minutes earlier, is a band that holds while it stays up", () => {
    const points = minutes((minute) => (minute < 40 ? 0.3 : 25_000))
    const [band] = spikes(points, hour)
    expect(spikes(points, hour)).toHaveLength(1)
    expect(band?.from).toBeCloseTo(40 / 60, 5)
    expect(band?.to).toBe(1)
  })

  test("ordinary rates, and a high rate with no jump in view, are not a spike", () => {
    expect(
      spikes(
        minutes(() => 0.3),
        hour,
      ),
    ).toEqual([])
    expect(
      spikes(
        minutes(() => 50),
        hour,
      ),
    ).toEqual([])
    expect(
      spikes(
        minutes(() => 25_000),
        hour,
      ),
    ).toEqual([])
    expect(
      spikes(
        minutes((minute) => (minute < 40 ? 50 : 200)),
        hour,
      ),
    ).toEqual([])
  })

  test("a jump uses the last known rate in the five minutes when that minute was not scraped", () => {
    const points = minutes((minute) => {
      if (minute === 55) return 174
      if (minute === 56) return 23_574
      if (minute === 57) return 20_473
      if (minute > 57) return 0.9
      return null
    })
    const [band] = spikes(points, hour)
    expect(spikes(points, hour)).toHaveLength(1)
    expect(band?.from).toBeCloseTo(56 / 60, 5)
    expect(band?.to).toBeCloseTo(58 / 60, 5)
  })

  test("a missing earlier point is not read as zero, and the band ends when the rate falls to 100", () => {
    const gap = minutes((minute) => (minute < 10 ? null : 25_000))
    expect(spikes(gap, hour)).toEqual([])
    const ended = minutes((minute) => (minute >= 40 && minute < 50 ? 25_000 : 0.3))
    const [band] = spikes(ended, hour)
    expect(band?.from).toBeCloseTo(40 / 60, 5)
    expect(band?.to).toBeCloseTo(50 / 60, 5)
  })

  test("two jumps are two bands", () => {
    const points = minutes((minute) => ((minute >= 10 && minute < 20) || minute >= 45 ? 25_000 : 0.3))
    const bands = spikes(points, hour)
    expect(bands).toHaveLength(2)
    expect(bands[0]?.from).toBeCloseTo(10 / 60, 5)
    expect(bands[1]?.to).toBe(1)
  })

  test("a spike on the newest point still has a width", () => {
    const points = minutes((minute) => (minute === 60 ? 25_000 : 0.3))
    const [band] = spikes(points, hour)
    expect(band?.to).toBe(1)
    expect(band?.from).toBeLessThan(1)
  })
})

afterAll(inBrowser())
await import("./spike.suite")
