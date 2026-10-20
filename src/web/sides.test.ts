import { describe, expect, test } from "bun:test"
import { Glob } from "bun"

describe("the pages' spacing", () => {
  test("names the start and end of a line, not its left and right", async () => {
    const physical: string[] = []
    for await (const path of new Glob("styles/*.css").scan(import.meta.dir)) {
      const css = await Bun.file(`${import.meta.dir}/${path}`).text()
      for (const [side] of css.matchAll(/\b(?:margin|padding)-(?:left|right)\s*:/g)) physical.push(`${path}: ${side}`)
    }
    expect(physical).toEqual([])
  })
})
