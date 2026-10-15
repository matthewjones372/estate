/** @jsxImportSource solid-js */
/** What the incident tool says of an incident, on its page: run by `incident-tool.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { IncidentRecord, ReadBack } from "../shared/incidents"
import { seenLive } from "../shared/timeline"
import { App } from "./App"
import { heard, now, operator } from "./fixture"
import { mount } from "./harness"
import { IncidentPage } from "./pages/Incident"
import { recording } from "./recording"

const link = "https://example.pagerduty.com/incidents/Q1ABC"

const raised = (inTool?: ReadBack): IncidentRecord => ({
  incident: {
    id: "i1",
    title: "Orders slow",
    openedBy: "gil",
    openedAt: "2026-10-03T11:50:00Z",
    firings: [],
    link,
    raised: { tool: "PagerDuty", id: "Q1ABC", by: "gil", at: "2026-10-03T11:51:00Z" },
  },
  events: [
    seenLive({
      id: "e1",
      at: "2026-10-03T11:51:00Z",
      by: "gil",
      kind: "incident-raised",
      text: "PagerDuty",
      link,
      environment: "production",
      alert: "a1",
    }),
  ],
  ...(inTool === undefined ? {} : { inTool }),
})

const opened = async (record: IncidentRecord) => {
  const { actions } = recording()
  const page = mount(() => <IncidentPage id="i1" />, {
    actions: { ...actions, incident: () => Promise.resolve(record) },
  })
  await page.settle()
  return page
}

const line = (container: HTMLElement) => container.querySelector(".incident-tool")?.textContent?.replace(/\s+/g, " ")

describe("the incident in the incident tool, on its page", () => {
  test("says its status there, its severity and who is on it, and links to it", async () => {
    const page = await opened(
      raised({ tool: "PagerDuty", said: { status: "acknowledged", severity: "P2", responders: ["ada", "gil"] } }),
    )
    expect(line(page.container)).toBe("In PagerDuty: acknowledged · P2 · ada, gil · Open in PagerDuty")
    expect(page.container.querySelector(".incident-tool a")?.getAttribute("href")).toBe(link)
  })

  test("says only what the tool said, with no one on it yet", async () => {
    const page = await opened(raised({ tool: "PagerDuty", said: { status: "triggered", responders: [] } }))
    expect(line(page.container)).toBe("In PagerDuty: triggered · Open in PagerDuty")
  })

  test("a tool that does not answer turns off its line, and the rest of the page is there", async () => {
    const page = await opened(raised({ tool: "PagerDuty", failing: "503: Service Unavailable" }))
    expect(line(page.container)).toBe("PagerDuty did not answer: 503: Service Unavailable · Open in PagerDuty")
    expect(page.container.querySelector("h1")?.textContent).toBe("Orders slow")
    expect(page.container.querySelector(".timeline li")?.textContent).toContain("raised in PagerDuty")
  })

  test("before the tool is read back, links to it there", async () => {
    const page = await opened(raised())
    expect(line(page.container)).toBe("In PagerDuty: Open in PagerDuty")
  })

  test("is read again as the stream beats, at most every half minute, while the incident is open", async () => {
    const listeners: Array<() => void> = []
    const base = heard()
    const live = {
      ...base,
      subscribe: (listener: () => void) => {
        listeners.push(listener)
        return base.subscribe(listener)
      },
    }
    let clock = now
    let reads = 0
    const { actions } = recording()
    const incident = () => {
      reads += 1
      return Promise.resolve(raised({ tool: "PagerDuty", said: { status: "acknowledged", responders: ["ada"] } }))
    }
    const page = mount(() => (
      <App
        estate={{
          live,
          me: operator,
          actions: { ...actions, incident },
          now: () => clock,
          page: () => ({ page: "incident" as const, id: "i1" }),
        }}
      />
    ))
    await page.settle()
    const beat = async () => {
      for (const listener of listeners) listener()
      await page.settle()
    }
    await beat()
    expect(reads).toBe(1)
    clock += 30_000
    await beat()
    expect(reads).toBe(2)
    expect(line(page.container)).toBe("In PagerDuty: acknowledged · ada · Open in PagerDuty")
  })
})
