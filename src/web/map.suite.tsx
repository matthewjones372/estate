/** @jsxImportSource solid-js */
/** Dead vs live map edges on the page: run by `map.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { mount } from "./harness"
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
