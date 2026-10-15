/** @jsxImportSource solid-js */
/** *Summary* on an incident's page (spec 0051): run by `incident-summary.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Me } from "../shared/events"
import type { Incident } from "../shared/incidents"
import { operator } from "./fixture"
import { mount } from "./harness"
import { IncidentPage } from "./pages/Incident"
import { IncidentSummary } from "./parts/IncidentSummary"
import { recording } from "./recording"

const incident: Incident = {
  id: "i1",
  title: "Orders slow",
  openedBy: "gil",
  openedAt: "2026-10-03T11:50:00Z",
  firings: [],
}
const withAi: Me = { ...operator, ai: true }
const changes: Array<string> = []
const changed = () => {
  changes.push("changed")
}

describe("an incident's summary", () => {
  test("is written by Summarise: what happened, impact, cause, the moments that mattered, what next and its cost", async () => {
    const page = mount(() => <IncidentSummary incident={incident} changed={changed} />, { me: withAi })
    expect(page.container.textContent).toContain("None yet")
    page.click(page.button("Summarise"))
    await page.settle()
    expect(page.calls).toContainEqual(["summarise", "i1"])
    const text = page.container.querySelector(".summary-answer")?.textContent ?? ""
    expect(text).toContain("recovered once it was rolled back")
    expect(text).toContain("Impact Checkouts took up to nine seconds")
    expect([...page.container.querySelectorAll(".summary-turns li")].map((each) => each.textContent)).toEqual([
      expect.stringMatching(/^\d\d:44 storefront main-88 deployed$/),
      expect.stringMatching(/^\d\d:58 rolled back$/),
    ])
    expect(page.container.querySelector(".ask-meta")?.textContent).toBe(
      "medium confidence · claude-haiku-5-5 · 15,000 in (6,000 cached) · 400 out · about $0.02",
    )
    expect(page.button("Summarise again")).toBeDefined()
  })

  test("is kept as an incident note marked as a summary", async () => {
    const recorded = recording()
    const notes: Array<ReadonlyArray<unknown>> = []
    const actions = {
      ...recorded.actions,
      addIncidentNote: (id: string, text: string, from?: "summary") => {
        notes.push([id, text, from])
        return Promise.resolve(incident)
      },
    }
    const page = mount(() => <IncidentSummary incident={incident} changed={changed} />, { me: withAi, actions })
    page.click(page.button("Summarise"))
    await page.settle()
    page.click(page.button("Keep as note"))
    await page.settle()
    expect(notes).toEqual([["i1", expect.stringMatching(/^Summary \(claude-haiku-5-5\): Orders slowed/), "summary"]])
    expect(page.button("Kept as a note")).toBeDefined()
    expect(changes).toEqual(["changed"])
  })

  test("is not offered where no model is set, and sits above the evidence where one is", async () => {
    const off = mount(() => <IncidentSummary incident={incident} changed={changed} />)
    expect(off.container.textContent).toBe("")
    const page = mount(() => <IncidentPage id="i1" />, { me: withAi })
    await page.settle()
    const order = [...page.container.querySelectorAll("main > section")].map((each) =>
      each.getAttribute("aria-labelledby"),
    )
    expect(order.slice(1, 3)).toEqual(["incident-summary", "incident-evidence"])
  })
})
