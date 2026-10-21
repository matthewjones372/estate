/** @jsxImportSource solid-js */
/** A silenced alert unsilenced where it is shown (spec 0065): run by `unsilence.test.ts`. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events, operator } from "./fixture"
import { mount } from "./harness"
import { AlertPage } from "./pages/Alert"
import { ServicePage } from "./pages/Service"
import { StorePage } from "./pages/Store"

/** The fixture's silenced alert, said to be about `about`. */
const silencedOn = (about: Partial<Alert>) => ({
  ...events,
  alerts: {
    ...events.alerts,
    alerts: events.alerts.alerts.map((alert) => (alert.id === "a2" ? { ...alert, ...about } : alert)),
  },
})
const said = "by ada: “resizing”"

describe("unsilencing an alert", () => {
  test("on its own page, which says who silenced it and why, and offers Unsilence in place of Silence", () => {
    const page = mount(() => <AlertPage id="a2" />)
    expect(page.container.querySelector(".silenced-row")?.textContent).toContain(said)
    expect(page.container.textContent).not.toContain("Silence…")
    page.click(page.button("Unsilence"))
    expect(page.calls).toContainEqual(["unsilence", "s1"])
  })

  test("on its service's page", () => {
    const page = mount(() => <ServicePage name="storefront" />, { sent: silencedOn({ service: "storefront" }) })
    expect(page.container.querySelector(".silenced-row")?.textContent).toContain(said)
    page.click(page.button("Unsilence"))
    expect(page.calls).toContainEqual(["unsilence", "s1"])
  })

  test("on its store's page", () => {
    const sent = silencedOn({ store: "orders-db" })
    const catalog = { ...events.catalog, stores: [{ name: "orders-db", engine: "postgres", links: [] }] }
    const page = mount(() => <StorePage name="orders-db" />, { sent: { ...sent, catalog } })
    expect(page.container.querySelector(".silenced-row")?.textContent).toContain(said)
    page.click(page.button("Unsilence"))
    expect(page.calls).toContainEqual(["unsilence", "s1"])
  })

  test("not by a viewer, who still sees who silenced it and why", () => {
    const page = mount(() => <AlertPage id="a2" />, { me: { ...operator, role: "viewer" } })
    expect(page.container.querySelector(".silenced-row")?.textContent).toContain(said)
    expect(page.container.textContent).not.toContain("Unsilence")
  })
})
