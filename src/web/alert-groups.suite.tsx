/** @jsxImportSource solid-js */
/** Many alerts read as one problem, grouped: run by `alert-groups.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events } from "./fixture"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"
import { ServicePage } from "./pages/Service"
import { recording } from "./recording"

const registry = { id: "i1", title: "Chip registry slow", closed: false, openedAt: "2026-10-03T11:45:00Z" }

const firing = (name: string, service: string, minutesAgo: number, over: Partial<Alert> = {}): Alert => ({
  id: name,
  name,
  state: "firing",
  severity: "warning",
  service,
  startsAt: new Date(Date.parse("2026-10-03T12:00:00Z") - minutesAgo * 60_000).toISOString(),
  labels: {},
  notes: [],
  ...over,
})

const inRegistry = (name: string, service: string, minutesAgo: number, over: Partial<Alert> = {}) =>
  firing(name, service, minutesAgo, { incident: registry, ...over })

/** Six in one incident (one of them on orders), three more on orders, and two on their own. */
const busy: ReadonlyArray<Alert> = [
  inRegistry("RegistrySlow", "registry", 14, {
    notes: [{ id: "n1", at: "2026-10-03T11:58:00Z", by: "gil", text: "registry restarted\nwatching" }],
  }),
  inRegistry("AdoptionsFailing", "adoptions", 12, { severity: "critical" }),
  inRegistry("ChipLookupsSlow", "chips", 10),
  inRegistry("PetsSlow", "pets", 9),
  inRegistry("SearchSlow", "search", 8),
  inRegistry("OrdersRegistryWait", "orders", 7),
  firing("OrdersSlow", "orders", 16),
  firing("OrdersErrors", "orders", 6),
  firing("OrdersQueue", "orders", 5),
  firing("CartSlow", "cart", 20),
  firing("PaymentsDown", "payments", 3, { severity: "critical" }),
]

const sent = (alerts: ReadonlyArray<Alert>) => ({ ...events, alerts: { ...events.alerts, alerts } })
const top = (container: HTMLElement) => [...(container.querySelector(".alert-rows")?.children ?? [])]
const said = (element: Element | undefined) => element?.textContent?.replace(/\s+/g, " ") ?? ""
const cards = (container: HTMLElement) => container.querySelectorAll(".alert-card").length

describe("needs you now, grouped", () => {
  test("six in one incident and three on one service read as two group rows, and the rest single", () => {
    const page = mount(() => <Overview />, { sent: sent(busy) })
    const shown = top(page.container)
    expect(shown).toHaveLength(4)
    expect(shown.filter((each) => each.classList.contains("alert-group"))).toHaveLength(2)
    expect(page.button("Chip registry slow, 6 alerts, worst critical")).toBeDefined()
    expect(page.button("orders, 3 alerts, worst warning")).toBeDefined()
  })

  test("orders groups and rows worst first, then longest firing", () => {
    const page = mount(() => <Overview />, { sent: sent(busy) })
    expect(top(page.container).map((each) => each.querySelector(".row-name")?.textContent)).toEqual([
      "Chip registry slow",
      "PaymentsDown",
      "CartSlow",
      "orders",
    ])
  })

  test("an incident's group says how many, the worst, how long it has been open, and its latest note", () => {
    const page = mount(() => <Overview />, { sent: sent(busy) })
    const group = said(top(page.container)[0])
    for (const words of ["incident · 6 alerts", "critical", "open 15 min", "latest: gil: “registry restarted”"])
      expect(group).toContain(words)
    expect(top(page.container)[0]?.querySelector("a.row-name")?.getAttribute("href")).toBe("/incidents/i1")
    const service = said(top(page.container)[3])
    expect(service).toContain("service · 3 alerts")
    expect(service).toMatch(/since \d\d:44/)
  })

  test("a group opens to its alerts' rows, worst first, each opening to its card; it is kept on moving back", () => {
    const { actions } = recording()
    const page = mount(() => <Overview />, { sent: sent(busy), actions })
    const toggle = page.button("Chip registry slow, 6 alerts, worst critical")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    page.click(toggle)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    const nested = page.container.querySelector(`#${toggle.getAttribute("aria-controls")}`)
    expect(nested?.tagName).toBe("UL")
    expect([...(nested?.children ?? [])].map((row) => row.querySelector(".row-name")?.textContent)).toEqual([
      "AdoptionsFailing",
      "RegistrySlow",
      "ChipLookupsSlow",
      "PetsSlow",
      "SearchSlow",
      "OrdersRegistryWait",
    ])
    expect(cards(page.container)).toBe(0)
    page.click(page.button("Open AdoptionsFailing's card"))
    expect(cards(page.container)).toBe(1)
    page.dispose()
    const again = mount(() => <Overview />, { sent: sent(busy), actions })
    expect(again.button("Chip registry slow, 6 alerts, worst critical").getAttribute("aria-expanded")).toBe("true")
    expect(again.button("Close AdoptionsFailing's card").getAttribute("aria-expanded")).toBe("true")
  })

  test("an alert in an incident is not also in its service's group", () => {
    const page = mount(() => <Overview />, { sent: sent(busy) })
    page.click(page.button("orders, 3 alerts, worst warning"))
    const orders = top(page.container)[3]?.querySelector("ul")
    expect([...(orders?.children ?? [])].map((row) => row.querySelector(".row-name")?.textContent)).toEqual([
      "OrdersSlow",
      "OrdersErrors",
      "OrdersQueue",
    ])
  })

  test("an incident or a service with one alert firing is a single row, its incident named on it", () => {
    const alone = [
      inRegistry("RegistrySlow", "registry", 14),
      firing("OrdersSlow", "orders", 16),
      firing("CartSlow", "cart", 20),
      firing("PaymentsDown", "payments", 3),
    ]
    const page = mount(() => <Overview />, { sent: sent(alone) })
    const shown = top(page.container)
    expect(shown.filter((each) => each.classList.contains("alert-group"))).toHaveLength(0)
    expect(said(shown.find((each) => each.textContent?.includes("RegistrySlow")))).toContain(
      "Part of Chip registry slow",
    )
  })
})

describe("what's happening on a service's page, grouped", () => {
  test("groups by incident only", () => {
    const orders = [
      inRegistry("OrdersRegistryWait", "orders", 7),
      inRegistry("OrdersChipWait", "orders", 9),
      firing("OrdersSlow", "orders", 16),
      firing("OrdersErrors", "orders", 6),
      firing("OrdersQueue", "orders", 5),
    ]
    const page = mount(() => <ServicePage name="orders" />, { sent: sent(orders) })
    expect(top(page.container).map((each) => each.querySelector(".row-name")?.textContent)).toEqual([
      "OrdersSlow",
      "Chip registry slow",
      "OrdersErrors",
      "OrdersQueue",
    ])
    expect(page.button("Chip registry slow, 2 alerts, worst warning")).toBeDefined()
  })
})
