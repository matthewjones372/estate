/** @jsxImportSource solid-js */
/** Many alerts at once, a row each: run by `alert-rows.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events } from "./fixture"
import { mount } from "./harness"
import { Alerts } from "./pages/Alerts"
import { Overview } from "./pages/Overview"
import { ServicePage } from "./pages/Service"
import { recording } from "./recording"

const firing = (at: number, over: Partial<Alert> = {}): Alert => ({
  id: `f${at}`,
  name: `Firing${at}`,
  state: "firing",
  severity: "warning",
  // Each on its own service, so none are grouped.
  service: `service${at}`,
  summary: `Firing number ${at}`,
  startsAt: `2026-10-03T11:${String(30 + at).padStart(2, "0")}:00Z`,
  labels: {},
  notes: [],
  ...over,
})

/** The alert as fired on a store rather than a service. */
const onStore = (alert: Alert, store: string): Alert => {
  const { service: _service, ...rest } = alert
  return { ...rest, store }
}

const sent = (alerts: ReadonlyArray<Alert>) => ({ ...events, alerts: { ...events.alerts, alerts } })
const several = (count: number, service?: string) =>
  Array.from({ length: count }, (_, at) => firing(at, service === undefined ? {} : { service }))
const rows = (container: HTMLElement) => [...container.querySelectorAll(".alert-rows > li")]
const cards = (container: HTMLElement) => container.querySelectorAll(".alert-card").length

describe("needs you now, with many firing", () => {
  test("shows cards for three firing", () => {
    const page = mount(() => <Overview />, { sent: sent(several(3)) })
    expect(cards(page.container)).toBe(3)
    expect(rows(page.container)).toHaveLength(0)
  })

  test("shows a row each for four, with its severity, name, service, time, latest note and incident", () => {
    const alerts = [
      firing(1, {
        service: "storefront",
        severity: "critical",
        notes: [
          { id: "n2", at: "2026-10-03T11:55:00Z", by: "ada", text: "looking at the cache\nand the pool" },
          { id: "n1", at: "2026-10-03T11:50:00Z", by: "gil", text: "older" },
        ],
        incident: { id: "i1", title: "Checkout", closed: false, openedAt: "2026-10-03T11:50:00Z" },
      }),
      onStore(firing(2), "orders-db"),
      firing(3),
      firing(4),
    ]
    const page = mount(() => <Overview />, { sent: sent(alerts) })
    expect(cards(page.container)).toBe(0)
    const shown = rows(page.container)
    expect(shown).toHaveLength(4)
    const first = shown[0]?.textContent ?? ""
    for (const words of ["critical", "Firing1", "storefront", "29 min", "ada: “looking at the cache”", "Checkout"])
      expect(first).toContain(words)
    expect(first).not.toContain("and the pool")
    expect(shown[0]?.querySelector("a.row-name")?.getAttribute("href")).toBe("/alerts/f1")
    expect(shown[1]?.textContent).toContain("orders-db")
    expect(shown[1]?.textContent).toContain("no notes")
  })

  test("says the count in the heading, and links to all on Alerts", () => {
    const page = mount(() => <Overview />, { sent: sent(several(4)) })
    expect(page.container.querySelector("#needs")?.textContent).toContain("Needs you now · 4 firing")
    const all = [...page.container.querySelectorAll("a")].find((each) => each.textContent?.startsWith("All on Alerts"))
    expect(all?.getAttribute("href")).toBe("/alerts")
  })

  test("a toggle opens that card under its row; Escape closes it and gives the toggle the focus", () => {
    const page = mount(() => <Overview />, { sent: sent(several(4)) })
    const toggle = page.button("Open Firing1's card")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    page.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    const opened = page.container.querySelector(`#${toggle.getAttribute("aria-controls")}`)
    expect(opened?.closest("li")).toBe(toggle.closest("li"))
    expect(opened?.querySelector(".alert-card")?.textContent).toContain("Firing number 1")
    expect(opened?.querySelector(".notes-line")).not.toBeNull()
    const inside = opened?.querySelector("button")
    inside?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    expect(cards(page.container)).toBe(0)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(document.activeElement).toBe(toggle)
  })

  test("two can be open at once, and stay open on moving away and back", () => {
    const { actions } = recording()
    const page = mount(() => <Overview />, { sent: sent(several(4)), actions })
    page.click(page.button("Open Firing1's card"))
    page.click(page.button("Open Firing2's card"))
    expect(cards(page.container)).toBe(2)
    page.click(page.button("Close Firing1's card"))
    expect(cards(page.container)).toBe(1)
    page.dispose()
    const again = mount(() => <Overview />, { sent: sent(several(4)), actions })
    expect(again.button("Close Firing2's card").getAttribute("aria-expanded")).toBe("true")
    expect(cards(again.container)).toBe(1)
  })

  test("orders the rows worst first, then longest firing", () => {
    const alerts = [firing(1), firing(2, { severity: "critical" }), firing(3, { severity: "info" }), firing(0)]
    const page = mount(() => <Overview />, { sent: sent(alerts) })
    expect(rows(page.container).map((row) => row.querySelector(".row-name")?.textContent)).toEqual([
      "Firing2",
      "Firing0",
      "Firing1",
      "Firing3",
    ])
  })
})

describe("what's happening on a service's page", () => {
  test("shows cards for three firing and rows for four", () => {
    const three = mount(() => <ServicePage name="storefront" />, { sent: sent(several(3, "storefront")) })
    expect(cards(three.container)).toBe(3)
    const four = mount(() => <ServicePage name="storefront" />, { sent: sent(several(4, "storefront")) })
    expect(rows(four.container)).toHaveLength(4)
    expect(cards(four.container)).toBe(0)
  })
})

describe("the alerts table", () => {
  test("says the latest note as a row does: who and its first line", () => {
    const alerts = [firing(1, { notes: [{ id: "n", at: "2026-10-03T11:55:00Z", by: "ada", text: "one\ntwo" }] })]
    const page = mount(() => <Alerts />, { sent: sent(alerts) })
    const row = page.container.querySelector("tbody tr")?.textContent ?? ""
    expect(row).toContain("ada: “one”")
    expect(row).not.toContain("two")
  })
})
