/** @jsxImportSource solid-js */
/** A spike drawn on the requests spark and chart: run by `spike.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Series } from "../shared/events"
import { whole } from "./chart"
import { mount } from "./harness"
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
})
