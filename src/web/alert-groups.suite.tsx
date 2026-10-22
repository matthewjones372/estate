/** @jsxImportSource solid-js */
/** Many alerts read as one problem, grouped: run by `alert-groups.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events } from "./fixture"
import { mount } from "./harness"
import { thingsOf } from "./needs"
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
/** Only the alerts need anyone: every service well, and no deploy stuck. */
const only = (alerts: ReadonlyArray<Alert>) => ({
  ...sent(alerts),
  services: {
    ...events.services,
    services: events.services.services.map((each) => ({ ...each, health: "healthy" as const, reasons: [] })),
  },
  deploys: { ...events.deploys, services: [] },
})
const top = (container: HTMLElement) => [...(container.querySelector(".alert-rows")?.children ?? [])]
const things = (container: HTMLElement) => [...container.querySelectorAll(".things > li")]
const said = (element: Element | undefined) => element?.textContent?.replace(/\s+/g, " ") ?? ""
const cards = (container: HTMLElement) => container.querySelectorAll(".alert-card").length

describe("what needs you, a row a thing", () => {
  test("an incident's alerts are one thing, an alert in none is one each, and the incident comes first", () => {
    expect(thingsOf(only(busy)).map((thing) => `${thing.kind} ${thing.title}`)).toEqual([
      "incident Chip registry slow",
      "alert PaymentsDown",
      "alert CartSlow",
      "alert OrdersSlow",
      "alert OrdersErrors",
      "alert OrdersQueue",
    ])
    const page = mount(() => <Overview />, { sent: only(busy) })
    expect(things(page.container)).toHaveLength(6)
    expect(page.container.querySelector("#needs")?.textContent).toBe("Six things need you")
    // With an incident open, the headline is what it means; without an impact, its title.
    expect(page.container.querySelector("h1")?.textContent).toBe("Chip registry slow")
  })

  test("an incident's row says how many alerts and which, links to it, and is as old as its first", () => {
    const page = mount(() => <Overview />, { sent: only(busy) })
    const incident = said(things(page.container)[0])
    for (const words of [
      "Incident",
      "6 alerts: AdoptionsFailing, RegistrySlow, ChipLookupsSlow, PetsSlow, SearchSlow, OrdersRegistryWait.",
      "14 min",
    ])
      expect(incident).toContain(words)
    expect(things(page.container)[0]?.querySelector("a.thing-title")?.getAttribute("href")).toBe("/incidents/i1")
  })

  test("an incident's row opens to its alerts' rows, each opening to its card; it is kept on moving back", () => {
    const { actions } = recording()
    const page = mount(() => <Overview />, { sent: only(busy), actions })
    const toggle = page.button("Open Chip registry slow's alerts")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    page.click(toggle)
    const nested = page.container.querySelector(`#${toggle.getAttribute("aria-controls")}`)
    expect(nested?.tagName).toBe("UL")
    expect(top(page.container).map((row) => row.querySelector(".row-name")?.textContent)).toEqual([
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
    const again = mount(() => <Overview />, { sent: only(busy), actions })
    expect(again.button("Close Chip registry slow's alerts").getAttribute("aria-expanded")).toBe("true")
    expect(again.button("Close AdoptionsFailing's card").getAttribute("aria-expanded")).toBe("true")
  })

  test("an alert's row opens its own card in place", () => {
    const page = mount(() => <Overview />, { sent: only(busy) })
    page.click(page.button("Open PaymentsDown's card"))
    expect(cards(page.container)).toBe(1)
    expect(page.container.querySelector(".things .row-card")?.getAttribute("aria-label")).toBe("PaymentsDown's card")
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
    const group = page.button("Chip registry slow, 2 alerts, worst warning")
    page.click(group)
    const nested = page.container.querySelector(`#${group.getAttribute("aria-controls")}`)
    expect([...(nested?.children ?? [])].map((row) => row.querySelector(".row-name")?.textContent)).toEqual([
      "OrdersChipWait",
      "OrdersRegistryWait",
    ])
    page.click(page.button("Open OrdersChipWait's card"))
    expect(cards(page.container)).toBe(1)
  })
})
