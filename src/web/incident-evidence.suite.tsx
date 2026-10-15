/** @jsxImportSource solid-js */
/** An incident's kept charts on its page: run by its `.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { EvidenceSet } from "../shared/evidence"
import { seenLive } from "../shared/timeline"
import { operator } from "./fixture"
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

  test("shows each service's errors and lines as kept, and what was left out", async () => {
    const line = (minute: number, text: string) => ({ at: `2026-10-03T11:${minute}:00Z`, pod: "storefront-1", text })
    const logs = {
      service: "storefront",
      environment: "production",
      from: "Loki",
      errors: [
        {
          shape: "ERROR pool exhausted for •••",
          count: 2,
          firstSeen: "2026-10-03T11:42:00Z",
          lastSeen: "2026-10-03T11:44:00Z",
          pods: ["storefront-1"],
          examples: [line(44, "ERROR pool exhausted for •••")],
        },
      ],
      lines: [line(42, "ERROR pool exhausted for •••"), line(44, "ERROR pool exhausted for •••"), line(45, "INFO ok")],
      leftOut: 7,
    }
    const page = withEvidence([{ ...set("Estate", 9), logs: [logs] }])
    await page.settle()
    const kept = page.container.querySelector(".kept-logs")
    expect(kept?.querySelector("h3")?.textContent).toBe(
      "storefront logs, production, from Loki: 3 lines kept, 7 left out past incidents.evidence.lines",
    )
    expect([...(kept?.querySelectorAll("tbody tr") ?? [])].map((row) => row.textContent)).toEqual([
      "2ERROR pool exhausted for •••",
    ])
    expect(
      [...(kept?.querySelectorAll(".kept-line") ?? [])].map((each) => each.textContent?.endsWith("INFO ok")),
    ).toEqual([false, false, true])
  })

  test("lists the traces kept, each opening on the trace page, slowest and failed first", async () => {
    const span = { id: "a", service: "storefront", name: "place order", kind: "server" as const, failed: false }
    const kept = (id: string, why: "slowest" | "failed" | "named", took: number, journey?: string) => ({
      id,
      environment: "production",
      why,
      ...(journey === undefined ? {} : { journey }),
      spans: [{ ...span, start: 0, end: took, failed: why === "failed" }],
    })
    const traces = [kept("t2", "slowest", 900, "order"), kept("t3", "failed", 40, "order"), kept("t9", "named", 60)]
    const page = withEvidence([{ ...set("Estate", 9), traces }])
    await page.settle()
    const links = [...page.container.querySelectorAll(".kept-traces a")]
    expect(links.map((each) => [each.textContent, each.getAttribute("href")])).toEqual([
      ["t2", "/journeys/order/t2"],
      ["t3", "/journeys/order/t3"],
      ["t9", "/traces/t9"],
    ])
    expect([...page.container.querySelectorAll(".kept-traces li")].map((each) => each.textContent)).toEqual([
      "t2 order, slowest, 900 ms",
      "t3 order, failed, 40 ms",
      "t9 named in a kept line, 60 ms",
    ])
  })

  test("tells a reader who may not read logs here that they and its traces are left out", async () => {
    const { actions } = recording()
    const page = mount(() => <IncidentPage id="i1" />, {
      me: { ...operator, role: "viewer", logsForOperators: true },
      actions: {
        ...actions,
        incident: (id) =>
          actions
            .incident(id)
            .then((found) => (typeof found === "object" ? { ...found, evidence: [set("Estate", 9)] } : found)),
      },
    })
    await page.settle()
    expect(page.container.querySelector(".incident-evidence .withheld")?.textContent).toBe(
      "Logs and the traces drawn from them are for operators here, so they are left out of what you read and export.",
    )
  })

  test("says nothing is kept yet before it is", async () => {
    const page = withEvidence([])
    await page.settle()
    expect(page.container.querySelector(".incident-evidence p")?.textContent).toBe(
      "Nothing is kept yet: it is kept when the incident closes, or when an operator keeps it now.",
    )
  })
})
