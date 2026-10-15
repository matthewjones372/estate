/** @jsxImportSource solid-js */
/** What people included, on an incident's page (spec 0051): run by `included-evidence.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Me } from "../shared/events"
import type { EvidenceSet } from "../shared/evidence"
import type { IncidentRecord } from "../shared/incidents"
import { allSeenLive } from "../shared/timeline"
import { operator } from "./fixture"
import { mount } from "./harness"
import { IncidentPage } from "./pages/Incident"
import { IncidentEvidence } from "./parts/IncidentEvidence"

const window = { start: 1_759_490_000, end: 1_759_493_600, step: 60 }
const line = { at: "2026-10-03T11:48:00Z", pod: "orders-1", level: "error", text: "payment provider timed out" }
const chart = { service: "orders", environment: "production", panel: "errors", query: "q", points: [1, 2, 3] }
const set = (id: string, keptBy: string, keptAt: string, more: Partial<EvidenceSet>): EvidenceSet => ({
  id,
  keptBy,
  keptAt,
  window,
  charts: [],
  from: "included",
  ...more,
})
const estateSet: EvidenceSet = { id: "e1", keptBy: "Estate", keptAt: "2026-10-03T11:40:00Z", window, charts: [chart] }
const errorsChart = set("s1", "gil", "2026-10-03T11:51:00Z", { charts: [chart], why: "errors start here" })
const ownLines = set("s2", "ada lovelace", "2026-10-03T11:55:00Z", {
  logs: [{ service: "orders", environment: "production", from: "included", errors: [], lines: [line], leftOut: 0 }],
})
const gone = set("s3", "gil", "2026-10-03T11:56:00Z", { charts: [chart], why: "wrong chart" })
const record: IncidentRecord = {
  incident: { id: "i1", title: "Orders slow", openedBy: "gil", openedAt: "2026-10-03T11:50:00Z", firings: [] },
  events: allSeenLive([
    { id: "v1", at: "2026-10-03T11:57:00Z", by: "gil", kind: "evidence-removed", text: "removed", link: "s3" },
  ]).map((event) => ({ ...event, environment: "", alert: "" })),
  evidence: [estateSet, errorsChart, ownLines, gone],
}

const items = (container: HTMLElement) =>
  [...container.querySelectorAll(".included-item > .spread")].map((row) => row.textContent?.replace(/\s+/g, " ").trim())

const drawn = (me: Me = operator) => mount(() => <IncidentEvidence record={record} changed={() => {}} />, { me })

describe("what people included in an incident", () => {
  test("is listed newest first above Estate's own, with who, when and why, and what was removed left out", () => {
    const page = drawn()
    expect(items(page.container)).toEqual([
      expect.stringMatching(/^orders · 1 log line ada lovelace, 3 Oct \d\d:55 ?Remove$/),
      expect.stringMatching(/^orders · errors gil, 3 Oct \d\d:51 “errors start here” ?Remove$/),
    ])
    expect(page.container.querySelectorAll(".included-item .chart")).toHaveLength(1)
    expect(page.container.querySelector(".included-item .kept-logs")?.textContent).toContain(
      "payment provider timed out",
    )
    const titles = [...page.container.querySelectorAll(".incident-evidence h3")].map((each) => each.textContent)
    expect(titles.slice(0, 2)).toEqual(["Included", "orders logs, production: 1 lines kept"])
    expect(titles).toContain("Kept by Estate")
  })

  test("is removed by whoever included it or an operator, and by no one else", async () => {
    const viewer: Me = { ...operator, role: "viewer" }
    const own = drawn(viewer)
    expect(items(own.container).map((row) => row?.endsWith("Remove"))).toEqual([true, false])
    own.click(own.button("Remove"))
    await own.settle()
    expect(own.calls).toContainEqual(["removeIncluded", "i1", "s2"])
  })
})

describe("an incident's page", () => {
  test("shows its evidence before its firings", async () => {
    const page = mount(() => <IncidentPage id="i1" />)
    await page.settle()
    const order = [...page.container.querySelectorAll("main > section")].map((each) =>
      each.getAttribute("aria-labelledby"),
    )
    expect(order.indexOf("incident-evidence")).toBeLessThan(order.indexOf("incident-firings"))
  })
})
