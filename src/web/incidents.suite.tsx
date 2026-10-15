/** @jsxImportSource solid-js */
/** The incidents' own page, and the way to it from every page: run by `incidents.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { IncidentPage } from "./pages/Incident"
import { Incidents } from "./pages/Incidents"
import { Header } from "./parts/Header"
import { recording } from "./recording"

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll(".incidents tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent?.replace(/\s+/g, " ").trim()).join(" | "),
  )

const listed = async () => {
  const page = mount(() => <Incidents />)
  await page.settle()
  return page
}

describe("the incidents page", () => {
  test("lists every incident, open ones first and then closed, newest first, each linking to its page", async () => {
    const page = await listed()
    expect(page.calls).toContainEqual(["allIncidents"])
    expect(page.container.querySelector(".lede")?.textContent).toBe("2 open, 1 closed.")
    expect(rows(page.container)).toEqual([
      expect.stringMatching(/^Orders slow \| open 10 min \| Two firings · production, staging \| gil, 3 Oct \d\d:50$/),
      expect.stringMatching(/^Checkout down \| open 30 min \| No firings \| ada, 3 Oct \d\d:30$/),
      expect.stringMatching(
        /^Search slow \| closed after 1 h: the index was rebuilt \| One firing · production \| ada, 3 Oct \d\d:00$/,
      ),
    ])
    const link = page.container.querySelector<HTMLAnchorElement>(".incidents tbody a")
    expect(link?.getAttribute("href")).toBe("/incidents/i1")
    page.click(link as HTMLAnchorElement)
    expect(page.calls).toContainEqual(["navigate", "/incidents/i1"])
  })

  test("shows only the open or only the closed ones when asked", async () => {
    const page = await listed()
    page.click(page.button(/^Closed/))
    expect(rows(page.container)).toEqual([expect.stringMatching(/^Search slow \| closed/)])
    page.click(page.button(/^Open/))
    expect(rows(page.container).map((row) => row.split(" | ")[0])).toEqual(["Orders slow", "Checkout down"])
  })

  test("says how one is opened when there are none, and when they could not be read", async () => {
    const none = recording()
    const empty = mount(() => <Incidents />, { actions: { ...none.actions, allIncidents: () => Promise.resolve([]) } })
    await empty.settle()
    expect(empty.container.querySelector(".incidents-empty")?.textContent).toBe(
      "No incidents yet. An operator opens one from a firing alert's card with Link to incident.",
    )
    const broken = mount(() => <Incidents />, {
      actions: { ...none.actions, allIncidents: () => Promise.resolve(undefined) },
    })
    await broken.settle()
    expect(broken.container.querySelector(".incidents-empty")?.textContent).toBe("Incidents could not be read.")
  })
})

describe("an incident's page", () => {
  test("leads back to the incidents, found or not", async () => {
    const found = mount(() => <IncidentPage id="i1" />)
    const missing = mount(() => <IncidentPage id="nope" />)
    await found.settle()
    expect(found.container.querySelector(".crumbs")?.textContent).toBe("Overview / Incidents / Orders slow")
    expect(missing.container.querySelector('a[href="/incidents"]')?.textContent).toBe("All incidents")
  })
})

describe("the header", () => {
  test("links to the incidents from every page, marked current on the list and on an incident", () => {
    const linkOf = (page: Parameters<typeof mount>[1]) => {
      const mounted = mount(() => <Header />, page)
      return mounted.container.querySelector<HTMLAnchorElement>('nav a[href="/incidents"]')
    }
    expect(linkOf({})?.textContent?.trim()).toBe("Incidents")
    expect(linkOf({})?.getAttribute("aria-current")).toBeNull()
    expect(linkOf({ page: { page: "incidents" } })?.getAttribute("aria-current")).toBe("page")
    expect(linkOf({ page: { page: "incident", id: "i1" } })?.getAttribute("aria-current")).toBe("page")
  })
})
