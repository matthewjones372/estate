import { describe, expect, test } from "bun:test"
import { checks, passed, report, runGate } from "./checks"

describe("the gate", () => {
  test("runs every check in order, even after one fails", async () => {
    const ran: string[] = []
    const outcomes = await runGate(async (check) => {
      ran.push(check)
      return { passed: check !== "lint", output: `${check} said so` }
    })
    expect(ran).toEqual([...checks])
    expect(passed(outcomes)).toBe(false)
  })

  test("passes only when every check passes", async () => {
    const outcomes = await runGate(async () => ({ passed: true, output: "" }))
    expect(passed(outcomes)).toBe(true)
    expect(report(outcomes)).toEndWith("gate: passed")
  })

  test("names each failed check with the end of its output", async () => {
    const long = Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n")
    const outcomes = await runGate(async (check) =>
      check === "test" ? { passed: false, output: long } : { passed: true, output: "quiet" },
    )
    const text = report(outcomes)
    expect(text).toContain("── test ──\n…\nline 40\n")
    expect(text).toContain("line 99")
    expect(text).not.toContain("line 39\n")
    expect(text).not.toContain("quiet")
    expect(text).toContain("FAIL  test")
    expect(text).toEndWith("gate: failed (test). Nothing is done until it passes.")
  })
})
