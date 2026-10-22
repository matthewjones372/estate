/** @jsxImportSource solid-js */
/** A journey drawn on the estate's map, in happy-dom: run by `journey-map.test.ts`. */
import { describe, expect, test } from "bun:test"
import { withJourney } from "./fixture-traces"
import { mount } from "./harness"
import { EstateMap } from "./parts/Map"
import { mapChoice } from "./view-choices"

describe("a journey on the estate's map", () => {
  test("draws its route over the map, each node numbered with how long it usually spends there", async () => {
    const sent = withJourney("order")
    const catalog = sent.catalog
    if (catalog === undefined) throw new Error("no catalog")
    const page = mount(() => <EstateMap catalog={catalog} services={sent.services} layout={mapChoice()} />, { sent })
    expect(page.container.querySelector(".map-route")).toBeNull()
    page.click(page.button("Placing an order"))
    await page.settle()
    expect(page.calls).toContainEqual(["journey", "order"])
    expect(page.container.querySelectorAll(".map-route")).toHaveLength(2)
    const nodes = [...page.container.querySelectorAll(".map-on-route")].map((node) => [
      node.querySelector(".map-step")?.textContent,
      node.querySelector(".map-node-sub")?.textContent,
    ])
    expect(nodes).toEqual([
      ["1", "6 ms here"],
      ["2", "29 ms here"],
      ["3", "303 ms here"],
    ])
    expect(page.container.querySelector(".map-route-note")?.textContent).toContain(
      "Placing an order usually takes 341 ms end to end",
    )
    page.click(page.button("Placing an order"))
    expect(page.container.querySelector(".map-route")).toBeNull()
  })
})
