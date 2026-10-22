/** @jsxImportSource solid-js */
/** The map as areas on the overview (spec 0062): run by `map-areas.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"

describe("the map of a large estate as areas", () => {
  test("starts as areas, every part named, what needs someone first and never folded", async () => {
    const catalog = events.catalog
    if (catalog === undefined) throw new Error("no catalog")
    const names = Array.from({ length: 14 }, (_, index) => [`svc-${index}`, index < 4 ? "Shop" : "Data"] as const)
    const page = mount(() => <Overview />, {
      sent: {
        ...events,
        catalog: {
          ...catalog,
          services: names.map(([name, category]) => ({ name, links: [], category })),
          map: {
            nodes: names.map(([name]) => ({ id: name, title: name, kind: "service", service: name })),
            edges: [
              { from: "svc-0", to: "svc-11" },
              { from: "svc-11", to: "svc-5" },
            ],
          },
        },
        services: {
          ...events.services,
          services: names.map(([name]) => ({
            name,
            health: name === "svc-11" ? ("attention" as const) : ("healthy" as const),
            reasons: [],
            pods: [],
            jobs: [],
            load: {},
          })),
          edges: [
            { from: "svc-0", to: "svc-11", rate: 12, alerting: true },
            { from: "svc-11", to: "svc-5", rate: 3, alerting: false },
          ],
        },
      },
    })
    const parts = (area: string) =>
      [...page.container.querySelectorAll(`section[aria-label="${area}"] .map-part-name`)].map(
        (each) => each.textContent,
      )
    // Chosen in the overview's View menu (spec 0068), not on the map.
    const pressed = [...page.container.querySelectorAll('.view-menu button[aria-pressed="true"]')].map(
      (each) => each.textContent,
    )
    expect(pressed).toEqual(["Auto", "List"])
    expect([...page.container.querySelectorAll(".map button")].map((each) => each.textContent)).not.toContain("Lines")
    expect(page.container.querySelector(".map-node")).toBeNull()
    expect(parts("Shop")).toEqual(["svc-0", "svc-1", "svc-2", "svc-3"])
    expect(parts("Data")).toEqual(["svc-11", "svc-4", "svc-5", "svc-6", "svc-7", "svc-8"])
    expect(page.container.querySelector(".map-trouble-row")?.textContent).toBe("svc-012/ssvc-113/ssvc-5")
    page.click(page.button("+ 4 more, all healthy"))
    await page.settle()
    expect(parts("Data")).toHaveLength(10)
    page.click(page.button(/^svc-11/))
    await page.settle()
    const picked = page.container.querySelector('section[aria-label="svc-11 and what it talks to"]')
    expect([...(picked?.querySelectorAll(".map-near-part") ?? [])].map((each) => each.textContent)).toEqual([
      "svc-012/s",
      "svc-53/s",
    ])
    expect([...page.container.querySelectorAll(".map-near")].map((each) => each.textContent?.trim())).toEqual([
      "svc-0",
      "svc-5",
    ])
  })
})
