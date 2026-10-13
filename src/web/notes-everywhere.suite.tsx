/** @jsxImportSource solid-js */
/**
 * An incident's notes on a past firing's page and in *What changed today*, and every change there opening what it is
 * about: run by `notes-everywhere.test.ts` once Solid's compiler is in place.
 */
import { describe, expect, test } from "bun:test"
import type { FeedEvent, FeedItem } from "../shared/feed"
import { mount } from "./harness"
import { FiringPage } from "./pages/Firing"
import { Feed } from "./parts/Feed"

const at = "2026-10-03T11:00:00Z"
const item = (kind: FeedItem["kind"], text: string, more: Partial<FeedItem> = {}): FeedItem => ({
  at,
  kind,
  text,
  ...more,
})
const answer = ["Likely cause: the pool is exhausted.", "Evidence: waits rose at 11:02.", "Next: resize it."].join("\n")

const feed: FeedEvent = {
  items: [
    item("alert", "OrdersSlow fired", { service: "orders", alert: "a1" }),
    item("resolved", "Restarted resolved", { firing: { alert: "a7", startsAt: "2026-10-03T08:00:00Z" } }),
    item("silence", "silenced OrdersSlow until 13:00: vacuum", { who: "gil", service: "orders", alert: "a1" }),
    item("note", "on it", { who: "gil", on: "OrdersSlow", alert: "a1" }),
    item("note", "pool resized", { who: "ada", on: "Restarted", firing: { alert: "a7", startsAt: at } }),
    item("note", answer, { who: "matt", incident: { id: "i1", title: "Chip registry slow" } }),
    item("deploy", "v3 applied", { service: "orders" }),
    item("deploy", "triage now uses claude-b", { service: "triage", agent: "triage" }),
    item("build", "build passed: Faster", { service: "orders", url: "https://ci.example/1" }),
    item("build", "build failed: Slower", { service: "orders" }),
    item("debug", "debug on until 12:05", { who: "ada", service: "storefront" }),
    item("job", "job settle succeeded", { service: "settle", job: "settle" }),
    item("job", "job reindex failed", { service: "orders" }),
  ],
}

const rows = (container: HTMLElement) => [...container.querySelectorAll(".feed li")]

describe("what changed today", () => {
  test("opens what each change is about, its whole line or, for a note, who wrote it and on what", () => {
    const page = mount(() => <Feed feed={feed} />)
    const opened = rows(page.container).map((row) => {
      const link = row.querySelector("a")
      return [link?.textContent?.replace(/\s+/g, " ").trim(), link?.getAttribute("href")]
    })
    expect(opened).toEqual([
      ["orders OrdersSlow fired", "/alerts/a1"],
      ["Restarted resolved", "/alerts/a7/2026-10-03T08:00:00Z"],
      ["gil: orders silenced OrdersSlow until 13:00: vacuum", "/alerts/a1"],
      ["gil: on OrdersSlow", "/alerts/a1"],
      ["ada: on Restarted", `/alerts/a7/${at}`],
      ["matt: on Chip registry slow", "/incidents/i1"],
      ["orders v3 applied", "/services/orders"],
      ["triage triage now uses claude-b", "/agents/triage"],
      ["orders build passed: Faster", "https://ci.example/1"],
      ["orders build failed: Slower", "/services/orders"],
      ["ada: storefront debug on until 12:05", "/services/storefront"],
      ["settle job settle succeeded", "/jobs/settle"],
      ["orders job reindex failed", "/services/orders"],
    ])
  })

  test("follows a link within Estate without reloading, and a build's link out in a new tab", () => {
    const page = mount(() => <Feed feed={feed} />)
    const [alert] = rows(page.container)
    page.click(alert?.querySelector("a") as HTMLAnchorElement)
    expect(page.calls).toContainEqual(["navigate", "/alerts/a1"])
    expect(page.container.querySelector('a[href="https://ci.example/1"]')?.getAttribute("target")).toBe("_blank")
  })

  test("labels an incident's note with its title, folds it when long, and keeps more out of the link", () => {
    const page = mount(() => <Feed feed={feed} />)
    const row = rows(page.container)[5]
    expect(row?.querySelector("a em")?.textContent).toBe("Chip registry slow")
    expect(row?.querySelector(".note-body")?.classList.contains("clamped")).toBe(true)
    expect(row?.querySelector("a button")).toBeNull()
    page.click(row?.querySelector(".note-more") as HTMLButtonElement)
    expect(row?.querySelector(".note-body")?.classList.contains("clamped")).toBe(false)
  })
})

describe("a past firing's page", () => {
  test("shows the notes of the incident it was in, labelled with its title, which links to the incident", async () => {
    const page = mount(() => <FiringPage id="a1" at="2026-10-01T09:00:00Z" />)
    await page.settle()
    const part = page.container.querySelector(".incident-part")
    expect(part?.textContent).toBe("Part of Orders slow (closed)")
    expect(part?.querySelector("a")?.getAttribute("href")).toBe("/incidents/i3")
    const notes = [...page.container.querySelectorAll(".alert-notes .alert-detail")].map((each) =>
      each.textContent?.replace(/\s+/g, " ").trim(),
    )
    expect(notes).toEqual([
      expect.stringMatching(/^“the pool was resized” on Orders slow \u2014 ada, \d\d:20$/),
      expect.stringMatching(/^“on it” \u2014 gil, \d\d:10$/),
    ])
    expect(page.container.querySelector(".alert-notes em a")?.getAttribute("href")).toBe("/incidents/i3")
  })
})
