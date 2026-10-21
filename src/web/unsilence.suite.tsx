/** @jsxImportSource solid-js */
/** A silence undone where it was made: run by `unsilence.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert, Events } from "../shared/events"
import { events, operator } from "./fixture"
import { clock } from "./format"
import { mount } from "./harness"
import { AlertPage } from "./pages/Alert"
import { ServicePage } from "./pages/Service"
import { StorePage } from "./pages/Store"

const silenced = (about: Partial<Alert>): Events => ({
  ...events,
  catalog: { ...events.catalog, stores: [{ name: "orders-db", engine: "redis", links: [] }] },
  alerts: {
    ...events.alerts,
    alerts: events.alerts.alerts.map((alert) => (alert.id === "a2" ? { ...alert, ...about } : alert)),
  },
})

const pages = [
  { where: "its own page", page: () => <AlertPage id="a2" />, sent: silenced({}) },
  {
    where: "its service's page",
    page: () => <ServicePage name="storefront" />,
    sent: silenced({ service: "storefront" }),
  },
  { where: "its store's page", page: () => <StorePage name="orders-db" />, sent: silenced({ store: "orders-db" }) },
]

describe("a silenced alert", () => {
  test("links to its page from its service's page", () => {
    const page = mount(() => <ServicePage name="storefront" />, { sent: silenced({ service: "storefront" }) })
    expect(page.container.querySelector(".silenced-row a")?.textContent).toBe("DiskFilling")
    page.dispose()
  })

  for (const { where, page: node, sent } of pages) {
    test(`says who silenced it, until when and why, and an operator unsilences it on ${where}`, () => {
      const page = mount(node, { sent })
      expect(page.container.textContent).toContain(`silenced until ${clock("2026-10-03T15:00:00Z")} by ada: “resizing”`)
      page.click(page.button("Unsilence"))
      expect(page.calls).toContainEqual(["unsilence", "s1"])
      page.dispose()
    })

    test(`shows a viewer the silence without Unsilence on ${where}`, () => {
      const page = mount(node, { sent, me: { ...operator, role: "viewer" } })
      expect(page.container.textContent).toContain("by ada: “resizing”")
      expect(page.container.textContent).not.toContain("Unsilence")
      page.dispose()
    })
  }

  test("is not offered to be silenced again on its own page, and its silence names it without a link", () => {
    const page = mount(() => <AlertPage id="a2" />, { sent: silenced({}) })
    expect(page.container.textContent).not.toContain("Silence…")
    expect(page.container.querySelector(".silenced-row a")).toBeNull()
    page.dispose()
  })
})
