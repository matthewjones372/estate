import { describe, expect, test } from "bun:test"
import { Glob } from "bun"

describe("the pages' colours", () => {
  test("are named only in the tokens, so a colour changed there changes everywhere it is used", async () => {
    const named: string[] = []
    for await (const path of new Glob("styles/*.css").scan(import.meta.dir)) {
      if (path === "styles/tokens.css") continue
      const css = await Bun.file(`${import.meta.dir}/${path}`).text()
      for (const [colour] of css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) named.push(`${path}: ${colour}`)
    }
    expect(named).toEqual([])
  })
})
