import { describe, expect, test } from "bun:test"
import { errorTest, groupErrors, type Line, levelOf, lineOf, masking, shapeOf } from "./lines"

const at = (minute: number) => `2026-10-03T12:${String(minute).padStart(2, "0")}:00.000Z`

describe("a log line", () => {
  test("has its level from its JSON, or from the first level word in its text", () => {
    expect(levelOf('{"level":"warning","message":"slow"}')).toBe("WARN")
    expect(levelOf('{"severity":"error"}')).toBe("ERROR")
    expect(levelOf("12:00 INFO  started in 2 s")).toBe("INFO")
    expect(levelOf("nothing to say")).toBeUndefined()
    expect(lineOf(at(1), "ERROR boom  ", "orders-1")).toEqual({
      at: at(1),
      pod: "orders-1",
      level: "ERROR",
      text: "ERROR boom",
    })
  })

  test("is an error by the catalog's pattern, or the default, against its level or else its text", () => {
    const byDefault = errorTest(undefined)
    expect(byDefault(lineOf(at(1), "java.lang.IllegalStateException: no"))).toBe(true)
    expect(byDefault(lineOf(at(1), '{"level":"info","message":"error count reset"}'))).toBe(false)
    const own = errorTest("SEVERE")
    expect(own(lineOf(at(1), "SEVERE: disk"))).toBe(true)
    expect(own(lineOf(at(1), "ERROR: disk"))).toBe(false)
  })

  test("is masked before it leaves Estate", () => {
    const masked = masking(["\\b\\d{16}\\b", "Bearer [\\w.-]+"])(
      lineOf(at(1), "card 4111111111111111 by Bearer abc.def"),
    )
    expect(masked.text).toBe("card ••• by •••")
    expect(masking(undefined)(lineOf(at(1), "untouched")).text).toBe("untouched")
  })
})

describe("errors", () => {
  test("are grouped by what their message says once times, ids, quoted values and numbers are taken out", () => {
    expect(
      shapeOf(
        lineOf(
          at(1),
          'payment 4f9c2a1b-1111-2222-3333-444455556666 failed after 3 tries at 2026-10-03T12:00:00Z: "card declined"',
        ),
      ),
    ).toBe("payment ‹id› failed after ‹n› tries at ‹time›: ‹…›")
    expect(shapeOf(lineOf(at(1), '{"level":"error","message":"order 1234 lost"}'))).toBe("order ‹n› lost")
    const lines: ReadonlyArray<Line> = [
      lineOf(at(1), "ERROR order 1 lost", "orders-1"),
      lineOf(at(2), "INFO order 2 placed", "orders-1"),
      lineOf(at(3), "ERROR order 3 lost", "orders-2"),
      lineOf(at(4), "ERROR database 0a1b2c3d4e5f60718293 timed out", "orders-2"),
    ]
    const groups = groupErrors(lines, errorTest(undefined))
    expect(groups.map((group) => [group.shape, group.count, group.pods])).toEqual([
      ["ERROR order ‹n› lost", 2, ["orders-1", "orders-2"]],
      ["ERROR database ‹id› timed out", 1, ["orders-2"]],
    ])
    expect(groups[0]).toMatchObject({ firstSeen: at(1), lastSeen: at(3) })
    expect(groups[0]?.examples.map((line) => line.at)).toEqual([at(3), at(1)])
  })
})
