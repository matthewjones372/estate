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
const raising: Me = { ...operator, incidentTool: "PagerDuty" }

const inTool = (container: HTMLElement) => container.querySelector(".incident-tool")

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll(".timeline li")].map((row) => row.textContent?.replace(/\s+/g, " ").trim())

const firings = (container: HTMLElement) =>
  [...container.querySelectorAll(".incident-firings li")].map((row) => row.textContent?.replace(/\s+/g, " ").trim())

const mayBelong = (container: HTMLElement) =>
  [...container.querySelectorAll(".incident-may-belong li > p")].map((row) => row.textContent)

const notes = (container: HTMLElement) =>
  [...container.querySelectorAll(".incident-notes .note-body")].map((each) => each.textContent)

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

  test("merges its firings' events in order, each saying which alert it was on, or that it was on the incident", async () => {
    const page = await opened("i1")
    const shown = rows(page.container)
    expect(shown).toHaveLength(6)
    expect(shown[0]).toMatch(/^3 Oct \d\d:40:00 Estate PaymentsDown fired: PaymentsDown, critical, payments$/)
    expect(shown[1]).toMatch(/:46:00 Estate OrdersSlow fired: OrdersSlow, critical, storefront$/)
    expect(shown[2]).toMatch(/:50:00 gil OrdersSlow opened incident "Orders slow" with this firing$/)
    expect(shown[3]).toMatch(/:52:00 ada PaymentsDown linked to incident "Orders slow"$/)
    expect(shown[4]).toMatch(/:53:00 gil \(incident\) noted on the incident: payments retried$/)
    expect(shown[5]).toMatch(/:55:00 Estate PaymentsDown resolved after 15 min$/)
  })

  test("an operator unlinks a firing, and the page reads the incident again", async () => {
    const page = await opened("i1")
    page.click(page.button("Unlink", 1))
    await page.settle()
    expect(page.calls).toContainEqual(["unlinkIncident", "i1", "staging", "a9", "2026-10-03T11:40:00Z"])
    expect(page.calls.filter(([name]) => name === "incident")).toHaveLength(2)
  })

  test("names the firing each Unlink would take out, for a reader that hears only the button", async () => {
    const page = await opened("i1")
    const named = [...page.container.querySelectorAll(".incident-firings button")].map((each) =>
      each.getAttribute("aria-label"),
    )
    expect(named).toEqual(["Unlink OrdersSlow in production", "Unlink PaymentsDown in staging"])
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

  test("opening Close incident… takes the focus to how it ended, since the button that opened it is gone", async () => {
    const page = await opened("i1")
    page.click(page.button("Close incident…"))
    expect(document.activeElement).toBe(page.container.querySelector(".incident-close input"))
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

  test("shows its notes, and a note added is kept and read back with the incident", async () => {
    const page = await opened("i1")
    expect(notes(page.container)).toEqual(["payments retried\nwatching"])
    expect(page.container.querySelector(".incident-notes .alert-quiet")?.textContent).toMatch(/^gil · \d\d:53 · Remove/)
    page.type(page.container.querySelector(".incident-notes input") as HTMLInputElement, " pool resized ")
    page.click(page.button("Add note"))
    expect(page.button(/Adding…/).getAttribute("aria-busy")).toBe("true")
    await page.settle()
    expect(page.calls).toContainEqual(["addIncidentNote", "i1", "pool resized"])
    expect(page.calls.filter(([name]) => name === "incident")).toHaveLength(2)
    expect(notes(page.container)).toEqual(["pool resized", "payments retried\nwatching"])
    expect((page.container.querySelector(".incident-notes input") as HTMLInputElement).value).toBe("")
    page.click(page.button(/Remove the note by gil/))
    await page.settle()
    expect(page.calls).toContainEqual(["removeIncidentNote", "i1", "n1"])
    expect(notes(page.container)).toEqual(["pool resized"])
  })

  test("shows its services and window, and an operator adds a service to it", async () => {
    const page = await opened("i1")
    const services = () => [...page.container.querySelectorAll(".incident-services li")].map((each) => each.textContent)
    expect(services()).toEqual(["storefront", "payments"])
    expect(page.container.querySelector(".incident-services .muted")?.textContent).toMatch(
      /^From 3 Oct \d\d:10 to now$/,
    )
    page.type(page.container.querySelector(".incident-services input") as HTMLInputElement, " orders ")
    page.click(page.button("Add service"))
    await page.settle()
    expect(page.calls).toContainEqual(["addIncidentService", "i1", "orders"])
    expect(services()).toEqual(["storefront", "payments", "orders"])
  })

  test("a viewer reads its services, but may not add one", async () => {
    const page = await opened("i1", viewer)
    expect(page.container.querySelectorAll(".incident-services li")).toHaveLength(2)
    expect(page.container.querySelector(".incident-services input")).toBeNull()
  })

  test("a note refused says why, and keeps what was written", async () => {
    const { actions } = recording()
    const page = mount(() => <IncidentPage id="i1" />, {
      actions: { ...actions, addIncidentNote: () => Promise.resolve("Estate could not be reached.") },
    })
    await page.settle()
    page.click(page.button("Add note"))
    expect(page.calls).toEqual([])
    page.type(page.container.querySelector(".incident-notes input") as HTMLInputElement, "fixed")
    page.click(page.button("Add note"))
    await page.settle()
    expect(page.container.querySelector('.incident-notes [role="alert"]')?.textContent).toBe(
      "Estate could not be reached.",
    )
    expect((page.container.querySelector(".incident-notes input") as HTMLInputElement).value).toBe("fixed")
  })

  test("a viewer reads it all, but may neither unlink a firing nor close it", async () => {
    const page = await opened("i1", viewer)
    expect(rows(page.container)).toHaveLength(6)
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
    expect(page.container.querySelector(".incident-notes")?.textContent).toContain("No notes were written on it.")
    expect(page.container.querySelector(".incident-notes input")).toBeNull()
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

  test("lists the firings that may belong, each with its environment and why; Link moves one in, Not this takes one off", async () => {
    const page = await opened("i1")
    expect(mayBelong(page.container)).toEqual([
      "QueueGrowing · production: it is on storefront too, and it fired 12 min after OrdersSlow.",
      "OrdersSlow · staging: the same alert is part of it in production, and this one fired 1 min before it.",
    ])
    page.click(page.button("Link"))
    await page.settle()
    expect(page.calls).toContainEqual(["linkIncident", "i1", "a3", "production"])
    expect(firings(page.container)[2]).toMatch(/^QueueGrowing · production · firing since \d\d:58 Unlink$/)
    expect(mayBelong(page.container)).toHaveLength(1)
    page.click(page.button("Not this"))
    await page.settle()
    expect(page.calls).toContainEqual(["dismissIncident", "i1", "a8", "staging"])
    expect(page.container.querySelector(".incident-may-belong")).toBeNull()
    expect((await opened("i1", viewer)).container.querySelector(".incident-may-belong")).toBeNull()
  })

  test("an operator raises it in the incident tool, and then it links to it there", async () => {
    const page = await opened("i1", raising)
    page.click(page.button("Raise in PagerDuty"))
    expect(page.button(/Raising…/).getAttribute("aria-busy")).toBe("true")
    await page.settle()
    expect(page.calls).toContainEqual(["raiseIncident", "i1"])
    expect(inTool(page.container)?.textContent).toBe("In PagerDuty: Open in PagerDuty")
    const link = inTool(page.container)?.querySelector("a")
    expect(link?.getAttribute("href")).toBe("https://example.pagerduty.com/incidents/Q1ABC")
    expect(page.container.textContent).not.toContain("Raise in PagerDuty")
  })

  test("a raise the tool refuses says why, in its words", async () => {
    const page = await opened("i2", raising)
    page.click(page.button("Raise in PagerDuty"))
    await page.settle()
    expect(inTool(page.container)?.querySelector('[role="alert"]')?.textContent).toBe(
      "PagerDuty answered 400: Invalid Input Provided: Service not found",
    )
  })

  test("only an operator raises an open incident, and only where a tool is set", async () => {
    for (const [id, me] of [
      ["i1", { ...raising, role: "viewer" }],
      ["i1", { ...raising, readOnly: true }],
      ["i1", operator],
      ["i3", raising],
    ] as const) {
      expect((await opened(id, me)).container.textContent).not.toContain("Raise in")
    }
  })
})
