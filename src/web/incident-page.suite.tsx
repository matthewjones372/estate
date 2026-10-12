/** @jsxImportSource solid-js */
/** An incident's own page: run by `incident-page.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Me } from "../shared/events"
import { App } from "./App"
import { heard, now, operator } from "./fixture"
import { mount } from "./harness"
import { IncidentPage } from "./pages/Incident"
import { recording } from "./recording"
import { firingPath } from "./route"

const viewer: Me = { ...operator, role: "viewer" }

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll(".timeline li")].map((row) => row.textContent?.replace(/\s+/g, " ").trim())

const firings = (container: HTMLElement) =>
  [...container.querySelectorAll(".incident-firings li")].map((row) => row.textContent?.replace(/\s+/g, " ").trim())

const opened = async (id: string, me: Me = operator) => {
  const page = mount(() => <IncidentPage id={id} />, { me })
  await page.settle()
  return page
}

describe("an incident's page", () => {
  test("shows its title, who opened it and how long it has been open", async () => {
    const page = await opened("i1")
    expect(page.calls).toContainEqual(["incident", "i1"])
    expect(page.container.querySelector("h1")?.textContent).toBe("Orders slow")
    expect(page.container.querySelector(".lede")?.textContent).toMatch(/^open 10 min · opened by gil, 3 Oct \d\d:50$/)
  })

  test("lists its firings, each linking to its live alert or its past firing, in its own environment", async () => {
    const page = await opened("i1")
    expect(firings(page.container)).toEqual([
      expect.stringMatching(/^OrdersSlow · production · firing since \d\d:46 Unlink$/),
      expect.stringMatching(/^PaymentsDown · staging · resolved, fired \d\d:40 Unlink$/),
    ])
    const [live, past] = [...page.container.querySelectorAll<HTMLAnchorElement>(".incident-firings a")]
    expect(live?.getAttribute("href")).toBe("/alerts/a1")
    expect(past?.getAttribute("href")).toBe(`${firingPath("a9", "2026-10-03T11:40:00Z")}?env=staging`)
    page.click(past as HTMLAnchorElement)
    expect(page.calls).toContainEqual(["choose", "staging"])
    expect(page.calls).toContainEqual(["navigate", firingPath("a9", "2026-10-03T11:40:00Z")])
    page.click(live as HTMLAnchorElement)
    expect(page.calls.filter(([name]) => name === "choose")).toHaveLength(1)
    expect(page.calls).toContainEqual(["navigate", "/alerts/a1"])
  })

  test("merges its firings' events in order, each saying which alert it was on", async () => {
    const page = await opened("i1")
    const shown = rows(page.container)
    expect(shown).toHaveLength(5)
    expect(shown[0]).toMatch(/^3 Oct \d\d:40:00 Estate PaymentsDown fired: PaymentsDown, critical, payments$/)
    expect(shown[1]).toMatch(/:46:00 Estate OrdersSlow fired: OrdersSlow, critical, storefront$/)
    expect(shown[2]).toMatch(/:50:00 gil OrdersSlow opened incident "Orders slow" with this firing$/)
    expect(shown[3]).toMatch(/:52:00 ada PaymentsDown linked to incident "Orders slow"$/)
    expect(shown[4]).toMatch(/:55:00 Estate PaymentsDown resolved after 15 min$/)
  })

  test("an operator unlinks a firing, and the page reads the incident again", async () => {
    const page = await opened("i1")
    page.click(page.button("Unlink", 1))
    await page.settle()
    expect(page.calls).toContainEqual(["unlinkIncident", "i1", "staging", "a9"])
    expect(page.calls.filter(([name]) => name === "incident")).toHaveLength(2)
  })

  test("an operator closes it with a line on how it ended, and not without one", async () => {
    const page = await opened("i1")
    page.click(page.button("Close incident…"))
    const close = page.button("Close incident")
    expect(close.disabled).toBe(true)
    page.type(page.container.querySelector(".incident-close input") as HTMLInputElement, " the pool was resized ")
    page.click(close)
    expect(page.button(/Closing…/).getAttribute("aria-busy")).toBe("true")
    await page.settle()
    expect(page.calls).toContainEqual(["closeIncident", "i1", "the pool was resized"])
    expect(page.container.querySelector(".incident-close")).toBeNull()
  })

  test("a refused change says why", async () => {
    const { actions } = recording()
    const page = mount(() => <IncidentPage id="i1" />, {
      actions: {
        ...actions,
        unlinkIncident: () => Promise.resolve('"Orders slow" is closed'),
        closeIncident: () => Promise.resolve("Estate could not be reached."),
      },
    })
    await page.settle()
    page.click(page.button("Unlink"))
    await page.settle()
    expect(page.container.querySelector('.incident-firings [role="alert"]')?.textContent).toBe(
      '"Orders slow" is closed',
    )
    page.click(page.button("Close incident…"))
    page.type(page.container.querySelector(".incident-close input") as HTMLInputElement, "fixed")
    page.click(page.button("Close incident"))
    await page.settle()
    expect(page.container.querySelector('.incident-close [role="alert"]')?.textContent).toBe(
      "Estate could not be reached.",
    )
    page.click(page.button("Cancel"))
    expect(page.container.querySelector(".incident-close")).toBeNull()
  })

  test("a viewer reads it all, but may neither unlink a firing nor close it", async () => {
    const page = await opened("i1", viewer)
    expect(rows(page.container)).toHaveLength(5)
    expect(page.container.textContent).not.toContain("Unlink")
    expect(page.container.textContent).not.toContain("Close incident")
  })

  test("a closed incident says who closed it, when and how it ended, and changes no more", async () => {
    const page = await opened("i3")
    expect(page.container.querySelector(".lede")?.textContent).toMatch(
      /^closed by gil, 3 Oct \d\d:00, after 1 h: the index was rebuilt · opened by ada, 3 Oct \d\d:00$/,
    )
    // Kept before an incident kept its firings' names, so the alert's id stands in.
    expect(firings(page.container)).toEqual([expect.stringMatching(/^a7 · production · resolved, fired \d\d:55$/)])
    expect(page.container.textContent).toContain("Nothing is kept for its firings yet.")
    expect(page.container.textContent).not.toContain("Unlink")
    expect(page.container.textContent).not.toContain("Close incident")
  })

  test("says when there is no such incident, and when it could not be read", async () => {
    expect((await opened("nope")).container.textContent).toContain("There is no incident nope here.")
    expect((await opened("broken")).container.textContent).toContain("The incident could not be read.")
  })

  test("is the page /incidents/:id names", async () => {
    const { actions } = recording()
    const estate = { live: heard(), me: operator, actions, now: () => now }
    const page = mount(() => <App estate={{ ...estate, page: () => ({ page: "incident" as const, id: "i1" }) }} />)
    await page.settle()
    expect(page.container.querySelector("h1")?.textContent).toBe("Orders slow")
  })
})
