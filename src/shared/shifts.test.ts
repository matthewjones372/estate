import { describe, expect, test } from "bun:test"
import type { ServiceState } from "./events"
import { applyShifts, shiftsBetween } from "./shifts"

const series = (points: ReadonlyArray<number | null>) => ({ now: points.at(-1) ?? null, points })
const service = (requests: ReadonlyArray<number | null>, extra: Partial<ServiceState> = {}): ServiceState => ({
  name: "orders",
  health: "healthy",
  reasons: [],
  pods: [],
  jobs: [],
  load: { requests: series(requests), stats: [{ title: "Heap", series: series([5, 6, 7, 8]) }] },
  ...extra,
})

describe("a service's series moved along", () => {
  test("is the points that came on, and the page puts them back together", () => {
    const before = service([1, 2, 3, 4])
    const after = service([2, 3, 4, 5])
    const shifts = shiftsBetween(before, after)
    expect(shifts).toEqual([{ service: "orders", series: "requests", shift: 1, tail: [5] }])
    expect(applyShifts(before, shifts ?? [])).toEqual(after)
  })

  test("carries the last points too when late samples revised them", () => {
    const before = service([1, 2, 3, 4])
    const after = service([2, 3, 4.5, 5])
    const shifts = shiftsBetween(before, after)
    expect(shifts).toEqual([{ service: "orders", series: "requests", shift: 1, tail: [4.5, 5] }])
    expect(applyShifts(before, shifts ?? [])).toEqual(after)
  })

  test("moves stats as well, and leaves a series that did not move", () => {
    const before = service([1, 2, 3, 4])
    const after = service([1, 2, 3, 4], {
      load: { requests: series([1, 2, 3, 4]), stats: [{ title: "Heap", series: series([6, 7, 8, null]) }] },
    })
    const shifts = shiftsBetween(before, after)
    expect(shifts).toEqual([{ service: "orders", series: "stats.0", shift: 1, tail: [null] }])
    expect(applyShifts(before, shifts ?? [])).toEqual(after)
    expect(applyShifts(before, [{ service: "search", series: "requests", shift: 1, tail: [9] }])).toBe(before)
  })

  test("is nothing when anything else changed, or a series changed too much to be moved", () => {
    expect(shiftsBetween(service([1, 2, 3, 4]), service([2, 3, 4, 5], { health: "attention" }))).toBeUndefined()
    expect(shiftsBetween(service([1, 2, 3, 4, 5, 6]), service([9, 9, 9, 9, 9, 9]))).toBeUndefined()
    expect(shiftsBetween(service([1, 2, 3]), service([1, 2, 3, 4]))).toBeUndefined()
    const without = service([1, 2], { load: { requests: series([1, 2]) } })
    expect(shiftsBetween(without, service([2, 3]))).toBeUndefined()
  })
})
