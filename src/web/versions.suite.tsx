/** @jsxImportSource solid-js */
/** Cross-env versions strip on the service page: run by `versions.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount, render } from "./harness"
import { ServicePage } from "./pages/Service"

const text = (html: string) =>
  html
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")

describe("versions across environments", () => {
  test("the service page names every environment's version", () => {
    const page = text(render(() => <ServicePage name="storefront" />))
    for (const words of ["Across environments", "staging", "production", "running v2"]) expect(page).toContain(words)
    const orders = text(render(() => <ServicePage name="orders" />))
    expect(orders).toContain("cannot scan the registry")
    expect(orders).toContain("v7")
  })

  test("chooses another environment from the service strip", () => {
    const page = mount(() => <ServicePage name="storefront" />)
    const staging = page.container.querySelector('button[aria-label^="staging:"]')
    if (staging === null) throw new Error(`no staging version cell in ${page.container.textContent}`)
    page.click(staging as HTMLElement)
    expect(page.calls).toContainEqual(["choose", "staging"])
    const production = page.container.querySelector('button[aria-label^="production:"]')
    if (production === null) throw new Error(`no production version cell in ${page.container.textContent}`)
    page.click(production as HTMLElement)
    expect(page.calls.filter((each) => each[0] === "choose")).toEqual([["choose", "staging"]])
    page.dispose()
  })
})
