import { describe, expect, test } from "bun:test"
import { findSlop, isChecked } from "./rules"

const rules = (path: string, text: string) => findSlop(path, text).map((finding) => finding.rule)

describe("the slop check", () => {
  test("passes clean code", () => {
    expect(rules("src/web/a.ts", "export const a = (b: number) => b + 1\n// why: the API counts from one\n")).toEqual(
      [],
    )
  })

  test("refuses a TODO and a FIXME", () => {
    expect(rules("src/web/a.ts", "// TODO later\n// FIXME now\n")).toEqual(["a TODO or FIXME", "a TODO or FIXME"])
  })

  test("refuses commented-out code", () => {
    for (const line of ["// const a = 1", "// doThing(a);", "// if (a) {", "// import { a } from 'b'", "  // }"]) {
      expect(rules("src/web/a.ts", line)).toEqual(["commented-out code"])
    }
  })

  test("leaves prose comments alone", () => {
    for (const line of ["// a reconnect resumes from Last-Event-ID", "// see decode() for why", "// return early"]) {
      expect(rules("src/web/a.ts", line)).toEqual([])
    }
  })

  test("refuses placeholder text", () => {
    expect(rules("src/web/a.ts", 'const a = "Lorem ipsum dolor"\n')).toEqual(["placeholder text"])
    expect(rules("src/web/a.ts", 'const b = "not implemented"\n')).toEqual(["placeholder text"])
  })

  test("refuses a skipped or focused test", () => {
    for (const line of ['test.skip("a", () => {})', 'it.only("a", () => {})', 'describe.skip("a", () => {})']) {
      expect(rules("src/web/a.test.ts", line)).toEqual(["a skipped or focused test"])
    }
  })

  test("refuses a rule switched off inline", () => {
    for (const line of ["const a = 1 /* biome-ignore lint: no */", "/* @ts-ignore */", "/* @ts-expect-error */"]) {
      expect(rules("src/web/a.ts", line)).toEqual(["a rule switched off inline"])
    }
  })

  test("refuses a file over 300 lines", () => {
    const text = "export const a = 1\n".repeat(301)
    expect(findSlop("src/web/a.ts", text)).toEqual([{ path: "src/web/a.ts", line: 301, rule: "a file over 300 lines" }])
    expect(rules("src/web/a.ts", "export const a = 1\n".repeat(300))).toEqual([])
  })

  test("refuses throw, try, async and new Promise in server and shared code", () => {
    const text = 'throw new Error("a")\ntry { a() } finally {}\nconst f = async () => 1\nnew Promise(() => 1)\n'
    const expected = [
      "throw, where Effect.fail belongs",
      "try, where Effect.try or catchTag belongs",
      "async, where Effect.gen belongs",
      "new Promise, where Effect.async belongs",
    ]
    expect(rules("src/server/a.ts", text)).toEqual(expected)
    expect(rules("src/shared/a.ts", text)).toEqual(expected)
    expect(rules("src/web/a.ts", text)).toEqual([])
  })

  test("refuses an Effect run outside the server's entry and tests", () => {
    const text = "Effect.runPromise(program)\n"
    expect(rules("src/server/a.ts", text)).toEqual(["an Effect run outside the entry"])
    expect(rules("src/web/a.ts", text)).toEqual(["an Effect run outside the entry"])
    expect(rules("src/server/main.ts", text)).toEqual([])
    expect(rules("src/server/a.test.ts", text)).toEqual([])
  })

  test("checks code, and not its own rules", () => {
    expect(isChecked("src/web/a.tsx")).toBe(true)
    expect(isChecked("tools/gate.ts")).toBe(true)
    expect(isChecked("tools/slop/rules.ts")).toBe(false)
    expect(isChecked("specs/0001.md")).toBe(false)
  })
})
