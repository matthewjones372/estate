/** @jsxImportSource solid-js */
/** A timeline's Copy as Markdown and Download: run by `timeline-export.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { AlertPage } from "./pages/Alert"
import { FiringPage } from "./pages/Firing"
import { IncidentPage } from "./pages/Incident"
import { TimelineExport } from "./parts/TimelineExport"

/** A clipboard that keeps what is written to it, or refuses it. */
const clipboard = (refuses = false) => {
  const copied: Array<string> = []
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) =>
        refuses ? Promise.reject(new Error("not allowed")) : Promise.resolve(void copied.push(text)),
    },
  })
  return copied
}

const downloads = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLAnchorElement>(".timeline-export a")].map((link) => [
    link.textContent,
    link.getAttribute("href"),
    link.hasAttribute("download"),
  ])

const said = (container: HTMLElement) => container.querySelector(".timeline-export [role=status]")?.textContent

describe("a timeline to take away", () => {
  test("is beside the Timeline heading on the alert's page, for the live firing in the page's environment", async () => {
    const page = mount(() => <AlertPage id="a1" />)
    await page.settle()
    const head = page.container.querySelector("#alert-timeline")?.parentElement
    expect(head?.querySelector(".timeline-export button")?.textContent).toBe("Copy as Markdown")
    const at = encodeURIComponent("2026-10-03T11:46:00Z")
    expect(downloads(page.container)).toEqual([
      ["Markdown", `/api/firings/a1/timeline?env=production&at=${at}&format=md`, true],
      ["JSON", `/api/firings/a1/timeline?env=production&at=${at}&format=json`, true],
    ])
  })

  test("is on a past firing's page, and copies its Markdown, saying so", async () => {
    const copied = clipboard()
    const page = mount(() => <FiringPage id="a1" at="2026-10-02T09:00:00Z" />)
    await page.settle()
    expect(
      page.container.querySelector("#firing-timeline")?.parentElement?.querySelector(".timeline-export"),
    ).not.toBeNull()
    page.click(page.button("Copy as Markdown"))
    await page.settle()
    expect(page.calls).toContainEqual(["timelineMarkdown", { alert: "a1", startsAt: "2026-10-02T09:00:00Z" }])
    expect(copied).toEqual(["# OrdersSlow\n"])
    expect(said(page.container)).toBe("Copied")
  })

  test("is on an incident's page, whose routes take no environment, with everything kept as a zip", async () => {
    clipboard()
    const page = mount(() => <IncidentPage id="i1" />)
    await page.settle()
    expect(
      page.container.querySelector("#incident-timeline")?.parentElement?.querySelector(".timeline-export"),
    ).not.toBeNull()
    expect(downloads(page.container)).toEqual([
      ["Markdown", "/api/incidents/i1/timeline?format=md", true],
      ["JSON", "/api/incidents/i1/timeline?format=json", true],
      ["Everything (zip)", "/api/incidents/i1/export?format=zip", true],
    ])
    page.click(page.button("Copy as Markdown"))
    await page.settle()
    expect(page.calls).toContainEqual(["timelineMarkdown", { incident: "i1" }])
  })

  test("has its status there before it says anything, so a screen reader hears it say Copied", async () => {
    clipboard()
    const page = mount(() => <TimelineExport of={{ incident: "i1" }} />)
    const status = page.container.querySelector(".timeline-export [role=status]")
    expect(status?.textContent).toBe("")
    page.click(page.button("Copy as Markdown"))
    await page.settle()
    expect(page.container.querySelector(".timeline-export [role=status]")).toBe(status)
    expect(status?.textContent).toBe("Copied")
  })

  test("says why it could not copy: the timeline was not read, the browser refused, or has no clipboard", async () => {
    const copied = clipboard()
    const unread = mount(() => <TimelineExport of={{ incident: "broken" }} />)
    unread.click(unread.button("Copy as Markdown"))
    await unread.settle()
    expect(copied).toEqual([])
    expect(said(unread.container)).toBe("The timeline could not be read (503).")
    clipboard(true)
    const refused = mount(() => <TimelineExport of={{ incident: "i1" }} />)
    refused.click(refused.button("Copy as Markdown"))
    await refused.settle()
    expect(said(refused.container)).toBe("The browser would not let it be copied.")
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined })
    const insecure = mount(() => <TimelineExport of={{ incident: "i1" }} />)
    insecure.click(insecure.button("Copy as Markdown"))
    await insecure.settle()
    expect(said(insecure.container)).toBe("This browser has no clipboard for Estate here.")
  })
})
