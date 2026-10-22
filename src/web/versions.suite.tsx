/** @jsxImportSource solid-js */
/** Cross-env versions strip on the service page: run by `versions.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
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

  test("the chip where the service is looked at is not green while the service is degraded", () => {
    const page = mount(() => <ServicePage name="storefront" />)
    const production = page.container.querySelector('button[aria-label^="production:"]')
    expect(production?.getAttribute("aria-label")).toBe("production: v2, degraded")
    expect(production?.querySelector(".dot")?.classList.contains("attention")).toBe(true)
    const staging = page.container.querySelector('button[aria-label^="staging:"]')
    expect(staging?.querySelector(".dot")?.classList.contains("healthy")).toBe(true)
    const well = {
      ...events,
      services: {
        ...events.services,
        services: events.services.services.map((each) => ({ ...each, health: "healthy" as const })),
      },
    }
    const quiet = mount(() => <ServicePage name="storefront" />, { sent: well })
    expect(quiet.container.querySelector('button[aria-label^="production:"]')?.getAttribute("aria-label")).toBe(
      "production: v2",
    )
  })

  test("the load charts mark the version applied and the alert fired, with a legend saying which is which", () => {
    const sent = {
      ...events,
      feed: {
        items: [
          {
            at: "2026-10-03T11:20:00Z",
            kind: "deploy" as const,
            service: "storefront",
            text: "v2 applied",
            version: "v2",
          },
        ],
      },
    }
    const page = mount(() => <ServicePage name="storefront" />, { sent })
    const legend = [...page.container.querySelectorAll(".chart-legend li")].map((each) => each.textContent)
    expect(legend).toHaveLength(2)
    expect(legend[0]).toMatch(/^v2 applied \d\d:20$/)
    expect(legend[1]).toMatch(/^OrdersSlow fired \d\d:46$/)
    const load = page.container.querySelector("#load")?.closest("section")
    // Three load charts and two stats, each marked.
    expect(load?.querySelectorAll(".charts .plot-deploy")).toHaveLength(5)
    expect(load?.querySelectorAll(".charts .plot-fired")).toHaveLength(5)
    expect(load?.querySelector(".charts svg")?.getAttribute("aria-label")).toMatch(
      /Marked: v2 applied \d\d:20; OrdersSlow/,
    )
  })
})
