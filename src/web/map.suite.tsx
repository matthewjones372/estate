/** @jsxImportSource solid-js */
/** Dead vs live map edges on the page: run by `map.test.ts` once Solid's compiler is in place. */
import { describe, expect, spyOn, test } from "bun:test"
import { events, listening } from "./fixture"
import { mount } from "./harness"
import * as layouts from "./layout"
import { Overview } from "./pages/Overview"

describe("dead map edges", () => {
  test("a live edge keeps its dash flow; a null-rate edge is solid and still", () => {
    const page = mount(() => <Overview />, {
      sent: {
        ...events,
        services: {
          ...events.services,
          services: events.services.services.map((each) =>
            each.name === "storefront" ? { ...each, health: "healthy" as const, reasons: [] } : each,
          ),
          edges: [
            { from: "storefront", to: "orders", rate: 12, alerting: false },
            { from: "orders", to: "db", rate: null, alerting: false },
          ],
        },
      },
    })
    expect(page.container.querySelectorAll("line.flow").length).toBe(1)
    expect(page.container.querySelectorAll("line.dead").length).toBe(1)
    expect([...page.container.querySelectorAll("line.dead")].every((line) => !line.classList.contains("flow"))).toBe(
      true,
    )
    page.dispose()
  })

  test("a zero rate or a failing source draws a dead edge with no flow class", () => {
    const page = mount(() => <Overview />, {
      sent: {
        ...events,
        services: {
          ...events.services,
          services: events.services.services.map((each) =>
            each.name === "storefront"
              ? { ...each, health: "critical" as const, reasons: ["down"] }
              : { ...each, health: "healthy" as const, reasons: [] },
          ),
          edges: [
            { from: "storefront", to: "orders", rate: 8, alerting: true },
            { from: "orders", to: "db", rate: 0, alerting: false },
          ],
        },
      },
    })
    expect(page.container.querySelectorAll("line.flow").length).toBe(0)
    expect(page.container.querySelectorAll("line.dead").length).toBe(2)
    page.dispose()
  })
})

describe("the map's layout", () => {
  test("is worked out again when its nodes or lines change, not when a node's health does", () => {
    const { live, send } = listening()
    send("catalog", events.catalog)
    send("services", events.services)
    const laid = spyOn(layouts, "layout")
    const page = mount(() => <Overview />, { live })
    const first = laid.mock.calls.length
    expect(first).toBeGreaterThan(0)
    send("services", {
      ...events.services,
      services: events.services.services.map((each) => ({ ...each, health: "critical" as const })),
    })
    expect(page.container.querySelector(".map-node.critical")).not.toBeNull()
    expect(laid.mock.calls.length).toBe(first)
    const catalog = events.catalog
    if (catalog === undefined) throw new Error("no catalog")
    send("catalog", { ...catalog, map: { ...catalog.map, edges: catalog.map.edges.slice(1) } })
    expect(laid.mock.calls.length).toBe(first + 1)
    laid.mockRestore()
    page.dispose()
  })
})
