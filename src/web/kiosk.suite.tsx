/** @jsxImportSource solid-js */
/** The estate on a screen, in happy-dom: run by \`kiosk.test.ts\` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Events, Me } from "../shared/events"
import { App } from "./App"
import { useEstate } from "./context"
import { events, heard, now, operator } from "./fixture"
import { mount } from "./harness"
import { firingOf, nextOf, staleSince, tilesOf, turnOf } from "./kiosk"
import { createLive, type Handlers } from "./live"
import { Kiosk } from "./pages/Kiosk"

const screen: Me = { ...operator, kiosk: true, screen: { environments: ["production", "staging"], every: 30 } }

describe("what a screen shows", () => {
  test("every service worst first, or a team's by the catalog's owner, with only its alerts", () => {
    expect(tilesOf(events, {}).map((service) => service.name)).toEqual(["storefront", "orders"])
    expect(tilesOf(events, { team: "web" }).map((service) => service.name)).toEqual(["storefront"])
    expect(firingOf(events, { team: "web" }).map((alert) => alert.name)).toEqual(["OrdersSlow"])
    expect(firingOf(events, { team: "payments" })).toEqual([])
  })

  test("or a category's, by the catalog's category", () => {
    const catalog = events.catalog
    if (catalog === undefined) throw new Error("no catalog")
    const categorised = {
      ...events,
      catalog: {
        ...catalog,
        services: catalog.services.map((each) => ({ ...each, category: each.name === "orders" ? "Payments" : "Shop" })),
      },
    }
    expect(tilesOf(categorised, { category: "Payments" }).map((service) => service.name)).toEqual(["orders"])
    expect(firingOf(categorised, { category: "Shop" }).map((alert) => alert.name)).toEqual(["OrdersSlow"])
    expect(firingOf(categorised, { category: "Payments" })).toEqual([])
    expect(tilesOf(categorised, { category: "Data" })).toEqual([])
  })

  test("takes turns, staying twice as long where something fires, and says when it has heard nothing", () => {
    expect(turnOf(30, 0)).toBe(30_000)
    expect(turnOf(30, 2)).toBe(60_000)
    expect(nextOf(["production", "staging"], "staging")).toBe("production")
    expect(staleSince(now - 60_000, now - 600_000, now)).toBeUndefined()
    expect(staleSince(now - 180_000, now - 600_000, now)).toBe(now - 180_000)
    expect(staleSince(undefined, now - 180_000, now)).toBe(now - 180_000)
  })
})

describe("the screen", () => {
  test("shows the headline, what is firing and every service, with nothing to press", () => {
    const page = mount(() => <Kiosk />, { me: screen, page: { page: "kiosk" } })
    const text = page.container.textContent ?? ""
    expect(page.container.querySelectorAll("button, input, textarea, a")).toHaveLength(0)
    expect(text).toContain("Production, three machines")
    expect([...page.container.querySelectorAll(".kiosk-tile-name")].map((tile) => tile.textContent)).toEqual([
      "storefront",
      "orders",
    ])
    expect(page.container.querySelector(".kiosk-stale")).toBeNull()
    page.dispose()
  })

  test("says in red when it has not been told anything for two minutes", () => {
    let handlers: Handlers | undefined
    const live = createLive(
      (_, given) => {
        handlers = given
        return () => undefined
      },
      "production",
      () => now - 180_000,
    )
    handlers?.onOpen()
    for (const [name, data] of Object.entries(events)) handlers?.onEvent(name as keyof Events, JSON.stringify(data))
    const page = mount(() => <Kiosk />, { me: screen, page: { page: "kiosk" }, live })
    expect(page.container.querySelector(".kiosk-stale")?.textContent).toMatch(/^Not updated since \d\d:57$/)
    page.dispose()
    expect(heard(events).snapshot().heardAt).toBe(now)
  })

  test("shows a team's services, and goes on to the next environment when its turn is over", async () => {
    const quick: Me = { ...screen, screen: { environments: ["production", "staging"], every: 0.005 } }
    const page = mount(() => <Kiosk team="web" />, { me: quick, page: { page: "kiosk", team: "web" } })
    expect(page.container.querySelector(".kiosk-team")?.textContent).toBe("web")
    expect([...page.container.querySelectorAll(".kiosk-tile-name")].map((tile) => tile.textContent)).toEqual([
      "storefront",
    ])
    page.container.querySelector("svg")?.dispatchEvent(new PointerEvent("pointerleave"))
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(page.calls).toContainEqual(["choose", "staging"])
    page.dispose()
  })

  test("is the whole page at /kiosk, with no header", () => {
    const page = mount(() => <App estate={useEstate()} />, { me: screen, page: { page: "kiosk", team: "web" } })
    expect(page.container.querySelector("header.kiosk-top")).not.toBeNull()
    expect(page.container.querySelector(".kiosk-team")?.textContent).toBe("web")
    expect(page.container.querySelector("nav")).toBeNull()
    page.dispose()
  })
})
