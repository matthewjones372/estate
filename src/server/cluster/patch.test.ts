import { describe, expect, test } from "bun:test"
import { applied, diff } from "./patch"

describe("a patch", () => {
  test("says an object by the keys that changed, those it lost, and its keys stay in their order", () => {
    const before = { a: 1, b: { c: [1, 2] }, gone: true }
    const after = { a: 1, b: { c: [1, 3] }, added: "x" }
    const patch = diff(before, after)
    expect(patch).toEqual({
      keys: { b: { keys: { c: { shift: 0, tail: [3] } } }, added: { set: "x" } },
      drop: ["gone"],
    })
    expect(Object.keys(applied(before, patch ?? { set: undefined }) as object)).toEqual(["a", "b", "added"])
    expect(applied(before, patch ?? { set: undefined })).toEqual(after)
  })

  test("says a series that only moved along by its new points, and one that did not whole", () => {
    expect(diff([1, 2, 3, 4], [2, 3, 4, 5])).toEqual({ shift: 1, tail: [5] })
    const ten = Array.from({ length: 10 }, (_, index) => index)
    expect(
      diff(
        ten,
        ten.map((each) => each * 2),
      ),
    ).toEqual({ set: ten.map((each) => each * 2) })
    expect(diff([1, 2], [1, 2, 3])).toEqual({ set: [1, 2, 3] })
    expect(applied([1, 2, 3, 4], { shift: 1, tail: [5] })).toEqual([2, 3, 4, 5])
  })

  test("is nothing for the same value, and the whole for anything else that changed", () => {
    expect(diff({ a: [{ b: 1 }] }, { a: [{ b: 1 }] })).toBeUndefined()
    expect(diff([{ b: 1 }], [{ b: 2 }])).toEqual({ set: [{ b: 2 }] })
    expect(diff("ok", "failing")).toEqual({ set: "failing" })
    expect(applied("x", { shift: 1, tail: [] })).toBeUndefined()
    expect(applied(undefined, { keys: { a: { set: 1 } } })).toEqual({ a: 1 })
  })
})
