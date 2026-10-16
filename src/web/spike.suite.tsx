/** @jsxImportSource solid-js */
/** A spike drawn on the requests spark and chart: run by `spike.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Series } from "../shared/events"
import { whole } from "./chart"
import { events } from "./fixture"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"
import { ServicePage } from "./pages/Service"
import { Chart, type Reading } from "./parts/Charts"
import { Spark } from "./parts/Sparkline"

const hour = 3_600_000
const end = Date.parse("2026-10-16T12:00:00Z")

const series = (points: ReadonlyArray<number>): Series => ({ now: points.at(-1) ?? null, points })

const jumped = series([...Array.from({ length: 40 }, () => 0.3), ...Array.from({ length: 21 }, () => 25_000)])

const reading = (): Reading => ({
  span: () => hour,
  over: () => "1h",
  starts: () => "1h ago",
  ends: () => "now",
  end: () => end,
  mark: () => undefined,
  onMark: () => undefined,
  zoom: () => whole,
  onZoom: () => undefined,
})

describe("a spike on the load", () => {
  test("the requests spark shades a spike and leaves the number and the line their ordinary colour", () => {
    const page = mount(() => <Spark label="Requests" unit="/s" series={jumped} spike />)
    expect(page.container.querySelectorAll(".plot-spike")).toHaveLength(1)
    expect(page.container.querySelector("polyline")?.getAttribute("stroke")).toBe("var(--quiet)")
    expect(page.container.querySelector(".spark-now")?.getAttribute("style") ?? "").not.toContain("amber")
    const quiet = mount(() => <Spark label="Requests" unit="/s" series={series([0.3, 0.3, 0.3])} spike />)
    expect(quiet.container.querySelector(".plot-spike")).toBeNull()
  })

  test("the requests chart shades a spike and the errors chart does not", () => {
    const requests = mount(() => (
      <Chart label="Requests" unit="/s" series={jumped} limit={undefined} reading={reading()} spike />
    ))
    expect(requests.container.querySelectorAll(".plot-spike")).toHaveLength(1)
    expect(requests.container.querySelector("polyline")?.getAttribute("stroke")).toBe("#8FB0FF")
    const errors = mount(() => <Chart label="Errors" unit="/s" series={jumped} limit={undefined} reading={reading()} />)
    expect(errors.container.querySelector(".plot-spike")).toBeNull()
  })

  test("the overview says there was an unusual spike, and All quiet and Needs you now stay as they are", () => {
    const quiet = mount(() => <Overview />)
    expect(quiet.container.querySelector("#signals")).toBeNull()
    const services = events.services.services.map((service, index) =>
      index === 0
        ? {
            ...service,
            health: "healthy" as const,
            reasons: [],
            load: { ...service.load, requests: { now: 25_000, points: jumped.points } },
          }
        : { ...service, health: "healthy" as const, reasons: [] },
    )
    const sent = {
      ...events,
      alerts: { ...events.alerts, alerts: [] },
      services: { ...events.services, services },
    }
    const page = mount(() => <Overview />, { sent })
    expect(page.container.querySelector("h1")?.textContent).toContain("All quiet")
    expect(page.container.querySelector("#needs")?.textContent).toContain("Needs you now")
    expect(page.container.textContent).toContain("Nothing. When something does, it appears here first.")
    const named = page.container.querySelector("#signals")?.closest("section")
    expect(named?.textContent).toContain("Interesting signals")
    expect(named?.textContent).toContain("Unusual spike in traffic to storefront")
    expect(named?.querySelectorAll(".plot-spike")).toHaveLength(1)
    expect(named?.querySelector(".spark-now")?.getAttribute("style") ?? "").not.toContain("amber")
    const service = mount(() => <ServicePage name="storefront" />, { sent })
    const load = service.container.querySelector("#load")?.closest("section")
    expect(load?.textContent).toContain("Unusual spike in traffic.")
    expect(load?.querySelectorAll(".plot-spike").length).toBeGreaterThan(0)
    expect(mount(() => <ServicePage name="storefront" />).container.textContent).not.toContain(
      "Unusual spike in traffic.",
    )
  })
})
