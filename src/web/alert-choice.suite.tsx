/** @jsxImportSource solid-js */
/** Auto, Cards or Rows for what is firing, Rows unless chosen, kept in this browser: run by `alert-choice.test.ts`. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events } from "./fixture"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"
import { ServicePage } from "./pages/Service"

const firing = (at: number, service = `service${at}`): Alert => ({
  id: `f${at}`,
  name: `Firing${at}`,
  state: "firing",
  severity: "warning",
  service,
  startsAt: `2026-10-03T11:${String(30 + at).padStart(2, "0")}:00Z`,
  labels: {},
  notes: [],
})

const several = (count: number, service?: string) =>
  Array.from({ length: count }, (_, at) => firing(at, service ?? `service${at}`))
const sent = (alerts: ReadonlyArray<Alert>) => ({ ...events, alerts: { ...events.alerts, alerts } })
const cards = (container: HTMLElement) => container.querySelectorAll(".alert-card").length
const rows = (container: HTMLElement) => container.querySelectorAll(".alert-rows > li").length
const pressed = (page: ReturnType<typeof mount>) =>
  ["Auto", "Cards", "Rows"].filter((name) => page.button(name).getAttribute("aria-pressed") === "true")

// This browser's storage, held here so each test starts with nothing chosen.
const held = new Map<string, string>()
const prior = Object.getOwnPropertyDescriptor(globalThis, "window")
beforeEach(() => {
  held.clear()
  Object.defineProperty(globalThis, "window", {
    value: {
      ...globalThis.window,
      localStorage: {
        getItem: (key: string) => held.get(key) ?? null,
        setItem: (key: string, value: string) => held.set(key, value),
      },
    },
    configurable: true,
  })
})
afterEach(() => {
  if (prior === undefined) Reflect.deleteProperty(globalThis, "window")
  else Object.defineProperty(globalThis, "window", prior)
})

describe("the alerts layout", () => {
  test("Rows, the default, shows a row for each even of two firing", () => {
    const two = mount(() => <Overview />, { sent: sent(several(2)) })
    expect(pressed(two)).toEqual(["Rows"])
    expect(rows(two.container)).toBe(2)
    expect(cards(two.container)).toBe(0)
  })

  test("Auto shows cards for three firing and switches to rows at four", () => {
    held.set("estate.alerts.layout", "auto")
    const three = mount(() => <Overview />, { sent: sent(several(3)) })
    expect(pressed(three)).toEqual(["Auto"])
    expect(cards(three.container)).toBe(3)
    const four = mount(() => <Overview />, { sent: sent(several(4)) })
    expect(rows(four.container)).toBe(4)
    expect(cards(four.container)).toBe(0)
  })

  test("choosing Cards with five firing shows five cards, kept across a reload", () => {
    const page = mount(() => <Overview />, { sent: sent(several(5)) })
    page.click(page.button("Cards"))
    expect(pressed(page)).toEqual(["Cards"])
    expect(cards(page.container)).toBe(5)
    expect(rows(page.container)).toBe(0)
    expect(held.get("estate.alerts.layout")).toBe("cards")
    page.dispose()
    const again = mount(() => <Overview />, { sent: sent(several(5)) })
    expect(pressed(again)).toEqual(["Cards"])
    expect(cards(again.container)).toBe(5)
  })

  test("choosing Rows shows rows for two firing, with All on Alerts, and Auto goes back to cards", () => {
    const page = mount(() => <Overview />, { sent: sent(several(2)) })
    page.click(page.button("Rows"))
    expect(rows(page.container)).toBe(2)
    expect(page.container.textContent).toContain("All on Alerts")
    page.click(page.button("Auto"))
    expect(cards(page.container)).toBe(2)
    expect(held.get("estate.alerts.layout")).toBe("auto")
  })

  test("is not offered while nothing fires", () => {
    const page = mount(() => <Overview />, { sent: sent([]) })
    expect(page.container.querySelector(".alerts-layout")).toBeNull()
  })

  test("is the same choice on a service's page", () => {
    held.set("estate.alerts.layout", "rows")
    const page = mount(() => <ServicePage name="storefront" />, { sent: sent(several(2, "storefront")) })
    expect(pressed(page)).toEqual(["Rows"])
    expect(rows(page.container)).toBe(2)
    page.click(page.button("Cards"))
    expect(cards(page.container)).toBe(2)
  })
})
