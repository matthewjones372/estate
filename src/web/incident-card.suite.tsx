/** @jsxImportSource solid-js */
/** An alert card's incident: run by `incident-card.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert, Me } from "../shared/events"
import { events, operator } from "./fixture"
import { mount } from "./harness"
import { AlertCard } from "./parts/AlertCard"
import { recording } from "./recording"

const ordersSlow = events.alerts?.alerts[0] as Alert

const viewer: Me = { ...operator, role: "viewer" }

const card = (alert: Alert, me: Me = operator) =>
  mount(() => <AlertCard alert={alert} catalog={events.catalog} canSilence={me.role === "operator"} />, { me })

const inIncident = (closed: boolean): Alert => ({ ...ordersSlow, incident: { id: "i1", title: "Orders slow", closed } })

/** The chooser, opened from the card. */
const choosing = async (alert: Alert = ordersSlow) => {
  const page = card(alert)
  page.click(page.button("Link to incident…"))
  await page.settle()
  return page
}

const chooser = (container: HTMLElement) => container.querySelector("fieldset.incident-chooser")

describe("an alert's incident, on its card", () => {
  test("a card says which incident it is part of and links to its page, marked closed once it is", () => {
    const open = card(inIncident(false))
    const link = open.container.querySelector<HTMLAnchorElement>('a[href="/incidents/i1"]')
    expect(link?.textContent).toBe("Orders slow")
    expect(open.container.querySelector(".incident-part")?.textContent).toBe("Part of Orders slow")
    open.click(link as HTMLAnchorElement)
    expect(open.calls).toContainEqual(["navigate", "/incidents/i1"])
    const closed = card(inIncident(true))
    expect(closed.container.querySelector(".incident-part")?.textContent).toBe("Part of Orders slow (closed)")
    expect(card(ordersSlow).container.querySelector(".incident-part")).toBeNull()
  })

  test("an operator links the alert to an open incident from the chooser", async () => {
    const page = await choosing()
    expect(page.calls).toContainEqual(["incidents"])
    const offered = [...(chooser(page.container)?.querySelectorAll(".incident-choice") ?? [])].map(
      (each) => each.textContent,
    )
    expect(offered).toEqual(["Orders slow", "Checkout down"])
    page.click(page.button("Orders slow"))
    expect(page.button(/Linking to Orders slow…/).disabled).toBe(true)
    await page.settle()
    expect(page.calls).toContainEqual(["linkIncident", "i1", "a1"])
    expect(chooser(page.container)).toBeNull()
  })

  test("the incident an alert is already part of is not offered again", async () => {
    const page = await choosing(inIncident(false))
    const offered = [...page.container.querySelectorAll(".incident-choice")].map((each) => each.textContent)
    expect(offered).toEqual(["Checkout down"])
  })

  test("an operator opens a new incident with the alert, which needs a title", async () => {
    const page = await choosing()
    expect(page.button("New incident").disabled).toBe(true)
    page.type(page.container.querySelector(".incident-chooser input") as HTMLInputElement, "  Chip registry slow ")
    page.click(page.button("New incident"))
    expect(page.button(/Opening…/).getAttribute("aria-busy")).toBe("true")
    await page.settle()
    expect(page.calls).toContainEqual(["openIncident", "Chip registry slow", "a1"])
    expect(chooser(page.container)).toBeNull()
  })

  test("a link refused says why and leaves the chooser open; Cancel closes it", async () => {
    const page = await choosing()
    page.click(page.button("Checkout down"))
    await page.settle()
    expect(page.container.querySelector('.incident-chooser [role="alert"]')?.textContent).toBe(
      '"Checkout down" is closed',
    )
    page.click(page.button("Cancel"))
    expect(chooser(page.container)).toBeNull()
  })

  test("says so when the open incidents cannot be read", async () => {
    const { actions } = recording()
    const broken = mount(() => <AlertCard alert={ordersSlow} catalog={events.catalog} canSilence />, {
      actions: { ...actions, incidents: () => Promise.resolve(undefined) },
    })
    broken.click(broken.button("Link to incident…"))
    await broken.settle()
    expect(chooser(broken.container)?.textContent).toContain("The open incidents could not be read.")
  })

  test("its incident's notes show among its own in time order, labelled, and are removed through the incident", () => {
    const on = { id: "i1", title: "Orders slow" }
    const notes = [
      { id: "n3", at: "2026-10-03T11:58:00Z", by: "gil", text: "pool resized\nwatching", incident: on },
      { id: "n2", at: "2026-10-03T11:56:00Z", by: "ada lovelace", text: "own note" },
      { id: "n1", at: "2026-10-02T11:55:00Z", by: "ada lovelace", text: "mine on it", incident: on },
    ]
    const page = card({ ...inIncident(false), notes })
    const heads = [...page.container.querySelectorAll(".note .alert-quiet")].map((each) => each.textContent)
    expect(heads).toEqual([
      expect.stringMatching(/^gil · \d\d:58 · on Orders slow · Remove the note by gil$/),
      expect.stringMatching(/^ada lovelace · \d\d:56 · Remove the note by ada lovelace$/),
      expect.stringMatching(/^ada lovelace · 2 Oct \d\d:55 · on Orders slow · Remove the note by ada lovelace$/),
    ])
    expect(page.container.querySelector(".note-body")?.textContent).toBe("pool resized\nwatching")
    page.click(page.button(/Remove the note by gil/))
    page.click(page.button(/Remove the note by ada lovelace/))
    expect(page.calls).toContainEqual(["removeIncidentNote", "i1", "n3"])
    expect(page.calls).toContainEqual(["removeNote", "n2"])
    const viewing = card({ ...inIncident(false), notes }, viewer)
    expect(viewing.container.textContent).not.toContain("Remove the note by gil")
    expect(viewing.container.textContent).toContain("Remove the note by ada lovelace")
    const closed = card({ ...inIncident(true), notes })
    expect(closed.container.querySelectorAll(".note-remove")).toHaveLength(1)
  })

  test("a viewer sees which incident a card is part of, but neither Link to incident… nor New incident", () => {
    const page = card(inIncident(false), viewer)
    expect(page.container.querySelector(".incident-part")?.textContent).toBe("Part of Orders slow")
    expect(page.container.textContent).not.toContain("Link to incident")
    expect(page.container.textContent).not.toContain("New incident")
  })
})
