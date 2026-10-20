import { describe, expect, test } from "bun:test"
import { Glob } from "bun"
import { compile } from "../shared/solid"

/**
 * The `style` attributes Solid writes into the templates of the files `pattern` names: a constant `style={{ … }}`
 * becomes one, which the shell's policy has to allow (spec 0055). A style that changes is set through the CSSOM.
 */
const written = async (pattern: string) => {
  const found: string[] = []
  for await (const path of new Glob(pattern).scan(import.meta.dir)) {
    const compiled = await compile(path, await Bun.file(`${import.meta.dir}/${path}`).text())
    for (const [style] of compiled.matchAll(/\bstyle=("[^"]*"|[^\s>`]+)/g)) found.push(`${path}: ${style}`)
  }
  return found.toSorted()
}

describe("the pages' styles", () => {
  test("no page writes a style attribute into its template, so how it looks is the stylesheets'", async () => {
    expect(await written("pages/*.tsx")).toEqual([])
  })
})
