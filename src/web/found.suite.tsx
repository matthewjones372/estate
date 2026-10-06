/** @jsxImportSource solid-js */
/** A found service on the page, in happy-dom: run by `found.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { FoundEntry, FoundMark } from "./parts/Found"

const discovered = { from: "kubernetes", yaml: "- name: basket\n  environments:\n    - production\n" }

describe("a service found in a cluster", () => {
  test("says where it was found, and nothing for a written one", () => {
    expect(mount(() => <FoundMark discovered={discovered} />).container.textContent).toBe("found in Kubernetes")
    expect(mount(() => <FoundMark discovered={undefined} />).container.textContent).toBe("")
    expect(mount(() => <FoundMark discovered={{ ...discovered, from: "backstage" }} />).container.textContent).toBe(
      "found in Backstage",
    )
    expect(mount(() => <FoundEntry discovered={undefined} />).container.textContent).toBe("")
  })

  test("copies its entry as YAML for the catalog", async () => {
    const copied: Array<string> = []
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => Promise.resolve(void copied.push(text)) },
    })
    const page = mount(() => <FoundEntry discovered={discovered} />)
    expect(page.container.textContent).toContain("Found in Kubernetes, not written in the catalog.")
    page.container.querySelector("button")?.click()
    await Promise.resolve()
    await Promise.resolve()
    expect(copied).toEqual([discovered.yaml])
    expect(page.container.querySelector("button")?.textContent).toBe("Copied")
  })
})
