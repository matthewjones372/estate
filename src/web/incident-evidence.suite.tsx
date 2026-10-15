/** @jsxImportSource solid-js */
/** An incident's kept charts on its page: run by its `.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { EvidenceSet } from "../shared/evidence"
import { seenLive } from "../shared/timeline"
import { mount } from "./harness"
import { IncidentPage } from "./pages/Incident"
import { recording } from "./recording"

const start = Date.parse("2026-10-03T11:10:00Z") / 1000
const set = (keptBy: string, last: number): EvidenceSet => ({
  id: keptBy,
  keptAt: "2026-10-03T12:00:00Z",
  keptBy,
  window: { start, end: start + 3000, step: 60 },
  charts: [
    {
      service: "storefront",
      environment: "production",
      panel: "requests",
      query: "sum(rate(x[1m]))",
      points: [1, 2, last],
    },
    {
      service: "storefront",
      environment: "production",
      panel: "Memory",
      unit: "bytes",
      query: "sum(m)",
      points: [3, null, 4],
    },
  ],
})

const withEvidence = (evidence: ReadonlyArray<EvidenceSet>) => {
  const { actions, calls } = recording()
  const events = [seenLive({ id: "e", at: "2026-10-03T11:46:00Z", by: "Estate", kind: "fired", text: "OrdersSlow" })]
  const page = mount(() => <IncidentPage id="i1" />, {
    actions: {
      ...actions,
      incident: (id) =>
        actions.incident(id).then((found) => (typeof found === "object" ? { ...found, events, evidence } : found)),
    },
  })
  return { ...page, calls }
}

describe("an incident's evidence, on its page", () => {
  test("draws the charts last kept, from the record alone, with its span shaded and its events marked", async () => {
    const page = withEvidence([set("gil", 3), set("Estate", 9)])
    await page.settle()
    const figures = [...page.container.querySelectorAll(".incident-evidence figure")]
    expect(figures.map((each) => each.querySelector("figcaption")?.textContent)).toEqual([
      "storefront requests, production",
      "storefront Memory (bytes), production",
    ])
    expect(page.container.querySelector(".incident-evidence .muted")?.textContent).toMatch(
      /^Kept by Estate, 3 Oct \d\d:00\. 2 sets kept\.$/,
    )
    expect(figures[0]?.querySelectorAll("line.plot-mark")).toHaveLength(1)
    expect(figures[0]?.querySelector("rect")).not.toBeNull()
    expect(page.calls.some(([name]) => name === "load")).toBe(false)
  })

  test("is kept now by an operator, and the page reads the incident again", async () => {
    const page = withEvidence([])
    await page.settle()
    page.click(page.button("Keep evidence now"))
    await page.settle()
    expect(page.calls).toContainEqual(["keepIncidentEvidence", "i1"])
    expect(page.calls.filter(([name]) => name === "incident")).toHaveLength(2)
  })

  test("says nothing is kept yet before it is", async () => {
    const page = withEvidence([])
    await page.settle()
    expect(page.container.querySelector(".incident-evidence p")?.textContent).toBe(
      "Nothing is kept yet: it is kept when the incident closes, or when an operator keeps it now.",
    )
  })
})
