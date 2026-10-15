/** @jsxImportSource solid-js */
/** A journey on a service's page and a trace's own page, in happy-dom: run by `traces.test.ts`. */
import { describe, expect, test } from "bun:test"
import type { Events } from "../shared/events"
import { App } from "./App"
import { events, heard, now, operator } from "./fixture"
import { mount } from "./harness"
import { TracePage } from "./pages/Trace"
import { JourneyLinks, Journeys } from "./parts/Journey"
import { recording } from "./recording"
import { pageOf } from "./route"

const withJourney = (name: string): Partial<Events> => ({
  ...events,
  ...(events.catalog === undefined
    ? {}
    : {
        catalog: {
          ...events.catalog,
          journeys: [{ name, title: "Placing an order", services: ["storefront", "orders"] }],
        },
      }),
})

const text = (container: HTMLElement) => container.textContent ?? ""

/** The panel, opened as a person would open it. */
const opened = async (service: string, journey: string) => {
  const page = mount(() => <Journeys service={service} />, { sent: withJourney(journey) })
  page.click(page.button("Show where its time goes"))
  await page.settle()
  return page
}

describe("a journey on a service's page", () => {
  test("is closed until asked for, and reads no traces until then", async () => {
    const page = mount(() => <Journeys service="storefront" />, { sent: withJourney("order") })
    await page.settle()
    expect(text(page.container)).toContain("Where its time goes, from a sample of its recent traces.")
    expect(page.button("Show where its time goes").getAttribute("aria-expanded")).toBe("false")
    expect(page.calls.filter(([name]) => name === "journey")).toEqual([])
    page.click(page.button("Show where its time goes"))
    await page.settle()
    expect(page.calls).toContainEqual(["journey", "order"])
    page.click(page.button("Hide"))
    expect(text(page.container)).not.toContain("It reaches its end")
  })

  test("says where its time goes, with a segment per stage and the largest stage marked", async () => {
    const page = await opened("storefront", "order")
    expect(text(page.container)).toContain("It reaches its end in 341 ms at p50. Waits in the outbox is 87% of the time its stages take.")
    expect(text(page.container)).toContain("The caller has an answer in 40 ms. 4 traces from the last 15 min")
    expect(page.container.querySelectorAll(".journey-segment")).toHaveLength(5)
    expect(page.container.querySelector(".journey-largest th")?.textContent).toBe("Waits in the outbox")
    expect(page.container.querySelector(".journey-largest .mono")?.textContent).toBe("INSERT outbox ··· publish")
  })

  test("switches to p99, and draws the typical trace in lanes, or another example picked", async () => {
    const page = await opened("storefront", "order")
    page.click(page.button("p99"))
    expect(text(page.container)).toContain("It reaches its end in 991 ms at p99.")
    const examples = () =>
      [...page.container.querySelectorAll(".journey-examples button")].map((each) => [
        each.textContent,
        each.getAttribute("aria-pressed"),
      ])
    expect(examples()).toEqual([
      ["Slowest · 991 ms", "false"],
      ["Slowest that failed · 341 ms", "false"],
      ["Typical · 521 ms", "true"],
      ["Fastest · 61 ms", "false"],
    ])
    expect(page.calls).toContainEqual(["trace", "t1", "order"])
    expect(
      [...page.container.querySelectorAll(".journey-lanes .trace-lane-name")].map((each) => each.textContent),
    ).toEqual(["storefront", "orders", "orders-db", "events"])
    page.click(page.button("Slowest · 991 ms"))
    await page.settle()
    expect(page.calls).toContainEqual(["trace", "t2", "order"])
    const open = page.container.querySelector(".journey-lanes > a")
    expect([open?.textContent, open?.getAttribute("href")]).toEqual([
      "Open this trace, as a waterfall too",
      "/journeys/order/t2",
    ])
  })

  test("says what a step in its lanes was, and says so when a picked trace cannot be read", async () => {
    const page = await opened("storefront", "order")
    await page.settle()
    const bar = [...page.container.querySelectorAll<HTMLButtonElement>(".journey-lanes .trace-lanes button")].find(
      (each) => each.getAttribute("aria-label") === "Published, events, 5 ms",
    )
    if (bar === undefined) throw new Error("no bar for Published")
    page.click(bar)
    expect(page.container.querySelector(".journey-lanes .trace-chosen")?.textContent).toContain("Published · events")
    page.click(bar)
    expect(page.container.querySelector(".journey-lanes .trace-chosen")).toBeNull()
    page.click(page.button("Fastest · 61 ms"))
    await page.settle()
    expect(text(page.container)).toContain("The trace could not be read.")
  })

  test("is linked from the service's links, and the link opens it on the service's page", async () => {
    const page = mount(
      () => (
        <>
          <JourneyLinks service="orders" />
          <Journeys service="orders" />
        </>
      ),
      { sent: withJourney("order") },
    )
    const link = page.container.querySelector<HTMLAnchorElement>("a.link-chip")
    expect([link?.textContent, link?.getAttribute("href")]).toEqual(["Placing an order", "/services/orders"])
    if (link === null) throw new Error("no link to the journey")
    page.click(link)
    await page.settle()
    expect(page.calls).toContainEqual(["navigate", "/services/orders"])
    expect(page.button("Hide").getAttribute("aria-expanded")).toBe("true")
    expect(page.calls).toContainEqual(["journey", "order"])
  })

  test("says why when there is no Tempo, or its traces could not be read, and is absent from other services", async () => {
    const none = await opened("storefront", "elsewhere")
    const broken = await opened("storefront", "broken")
    const other = mount(() => <Journeys service="search" />, { sent: withJourney("order") })
    expect(text(none.container)).toContain("There is no Tempo here to read its traces from.")
    expect(text(broken.container)).toContain("Its traces could not be read.")
    expect(text(other.container)).toBe("")
  })
})

describe("a trace's page", () => {
  test("draws its lanes, with a hand-off from one to the next and the long wait cut short", async () => {
    const page = mount(() => <TracePage id="t2" journey="order" />)
    await page.settle()
    expect(page.calls).toContainEqual(["trace", "t2", "order"])
    expect(text(page.container)).toContain(
      "Took 991 ms from its first span to its last; the caller had an answer in 40 ms.",
    )
    expect([...page.container.querySelectorAll(".trace-lane-name")].map((each) => each.textContent)).toEqual([
      "storefront",
      "orders",
      "orders-db",
      "events",
    ])
    expect(page.container.querySelectorAll(".trace-handoff").length).toBeGreaterThan(0)
    expect(page.container.querySelector(".trace-cut")).not.toBeNull()
    page.click(page.button("True scale"))
    expect(page.container.querySelector(".trace-cut")).toBeNull()
  })

  test("says what a step was when it is chosen in the lanes, and keeps it chosen in the waterfall", async () => {
    const page = mount(() => <TracePage id="t2" journey="order" />)
    await page.settle()
    expect(text(page.container)).toContain("Choose a step to see what it was")
    const wait = [...page.container.querySelectorAll<HTMLButtonElement>(".trace-lanes button")].find(
      (each) => each.getAttribute("aria-label") === "Waits in the outbox, orders-db, 950 ms",
    )
    if (wait === undefined) throw new Error("no bar for the outbox wait")
    page.click(wait)
    const chosen = () => page.container.querySelector(".trace-chosen")?.textContent ?? ""
    expect(chosen()).toContain("Waits in the outbox · orders-db")
    expect(chosen()).toContain("Took950 ms")
    expect(chosen()).toContain("Started36 ms in")
    expect(chosen()).toContain("Iswaiting between two spans")
    page.click(page.button("Waterfall"))
    expect(page.container.querySelector(".trace-row-chosen .trace-step")?.textContent).toBe("Waits in the outbox")
    page.click(page.button("Waits in the outbox"))
    expect(page.container.querySelector(".trace-chosen")).toBeNull()
  })

  test("says where a chosen step came from, and marks a step that failed", async () => {
    const page = mount(() => <TracePage id="t2" journey="order" />)
    await page.settle()
    page.click(page.button("Waterfall"))
    page.click(page.button("Published"))
    expect(page.container.querySelector(".trace-chosen")?.textContent).toContain("Came fromorders")
    const refused = mount(() => <TracePage id="t4" journey="order" />)
    await refused.settle()
    refused.click(refused.button("Waterfall"))
    refused.click(refused.button("Takes the order"))
    expect(refused.container.querySelector(".trace-chosen")?.textContent).toContain("Takes the order · orders · failed")
    expect(refused.container.querySelector(".trace-waterfall")?.textContent).toContain("29 ms failed")
  })

  test("lists the same steps as a waterfall, in time order, each with where and how long", async () => {
    const page = mount(() => <TracePage id="t2" journey="order" />)
    await page.settle()
    page.click(page.button("Waterfall"))
    const rows = [...page.container.querySelectorAll(".trace-waterfall tbody tr")].map((row) => [
      row.querySelector(".trace-step")?.textContent,
      row.querySelectorAll("td")[0]?.textContent,
      row.querySelector("td.number")?.textContent,
    ])
    expect(rows).toEqual([
      ["place order", "storefront", "40 ms"],
      ["Reaches orders", "storefront", "6 ms"],
      ["POST /orders", "orders", "32 ms"],
      ["Takes the order", "orders", "29 ms"],
      ["Written to the outbox", "orders-db", "3 ms"],
      ["Waits in the outbox", "orders-db", "950 ms"],
      ["Published", "events", "5 ms"],
    ])
  })

  test("says when the trace is not there, and is the page the app draws for a trace's address", async () => {
    const missing = mount(() => <TracePage id="gone" />)
    await missing.settle()
    expect(text(missing.container)).toContain("Trace gone is not in production's Tempo.")
    const { actions } = recording()
    const app = mount(
      () => (
        <App
          estate={{
            live: heard(events),
            me: operator,
            page: () => pageOf("/journeys/order/t2"),
            actions,
            now: () => now,
          }}
        />
      ),
      { actions },
    )
    await app.settle()
    expect(text(app.container)).toContain("Placing an order")
  })
})
