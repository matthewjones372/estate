import { describe, expect, test } from "bun:test"
import { around } from "./log-around"

const held = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]
const shown = (matching: ReadonlyArray<string>, count: number) =>
  around(held, (each) => matching.includes(each), count).map(
    (row) => `${row.gap ? "|" : ""}${row.match ? row.item.toUpperCase() : row.item}`,
  )

describe("the lines around a match", () => {
  test("are none at none, so only the matches show, with no gaps marked", () => {
    expect(shown(["c", "h"], 0)).toEqual(["C", "H"])
  })

  test("are the lines either side of each match, whatever they are, with a gap where lines were skipped", () => {
    expect(shown(["c", "h"], 1)).toEqual(["b", "C", "d", "|g", "H", "i"])
  })

  test("join where two matches' runs meet or overlap, each line once", () => {
    expect(shown(["c", "e"], 1)).toEqual(["b", "C", "d", "E", "f"])
    expect(shown(["c", "g"], 2)).toEqual(["a", "b", "C", "d", "e", "f", "G", "h", "i"])
  })

  test("stop at the first and last lines held", () => {
    expect(shown(["a", "j"], 2)).toEqual(["A", "b", "c", "|h", "i", "J"])
  })

  test("change nothing when every line matches, and show nothing when none does", () => {
    expect(shown(held, 5)).toEqual(held.map((each) => each.toUpperCase()))
    expect(shown([], 5)).toEqual([])
  })
})
