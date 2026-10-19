/** @jsxImportSource solid-js */
/** *Include in incident* on what the page shows (spec 0051): run by `include.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Me } from "../shared/events"
import type { PastFiring } from "../shared/firing"
import type { Incident } from "../shared/incidents"
import { now, operator } from "./fixture"
import { groups } from "./fixture-logs"
import { mount } from "./harness"
import { TracePage } from "./pages/Trace"
import { Load } from "./parts/Charts"
import { LoadThen } from "./parts/LoadThen"
import { ErrorList } from "./parts/LogErrors"
import { LogsPanel } from "./parts/Logs"
import { recording } from "./recording"

const ordersSlow = { id: "i1", title: "Orders slow" } as Incident
const checkoutDown = { id: "i2", title: "Checkout down" } as Incident

/** The page's actions with `open` as the incidents open now. */
const opened = (open: ReadonlyArray<Incident>) => {
  const recorded = recording()
  return { ...recorded.actions, incidents: () => Promise.resolve(open) }
}

const logs = async (open: ReadonlyArray<Incident>, me: Me = operator) => {
  const page = mount(() => <LogsPanel service="storefront" />, { actions: opened(open), me })
  await page.settle()
  return page
}

describe("including what was found in an incident", () => {
  test("picked lines go to the only open incident, with why", async () => {
    const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = []
    const recorded = recording()
    const actions = {
      ...recorded.actions,
      incidents: () => Promise.resolve([ordersSlow]),
      include: (...args: Parameters<typeof recorded.actions.include>) => {
        calls.push(["include", ...args])
        return recorded.actions.include(...args)
      },
    }
    const page = mount(() => <LogsPanel service="storefront" />, { actions })
    await page.settle()
    const picks = [...page.container.querySelectorAll<HTMLButtonElement>(".log-pick")]
    page.click(picks[1] as HTMLButtonElement)
    page.click(picks[2] as HTMLButtonElement, { shiftKey: true })
    page.click(page.button("Include 2 lines…"))
    const why = page.container.querySelector<HTMLInputElement>(".include-why input")
    page.type(why as HTMLInputElement, "the order is lost here")
    page.click(page.button("Include in Orders slow"))
    await page.settle()
    expect(calls).toEqual([
      [
        "include",
        "i1",
        {
          kind: "lines",
          environment: "production",
          service: "storefront",
          lines: [
            expect.objectContaining({ text: "ERROR order 41 lost" }),
            expect.objectContaining({ text: "WARN slow" }),
          ],
          why: "the order is lost here",
        },
      ],
    ])
    expect(page.container.querySelector(".include-told")?.textContent).toBe("Included in Orders slow")
  })

  test("offers each open incident when there are several, and is not offered with none or on a screen", async () => {
    const several = await logs([ordersSlow, checkoutDown])
    several.click(several.button("Include 3 lines…"))
    expect(several.button("Include in Orders slow")).toBeDefined()
    expect(several.button("Include in Checkout down")).toBeDefined()
    const none = await logs([])
    expect(none.container.textContent).not.toContain("Include")
    const screen = await logs([ordersSlow], { ...operator, kiosk: true })
    expect(screen.container.textContent).not.toContain("Include")
  })

  test("an error group goes as it is shown", async () => {
    const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = []
    const recorded = recording()
    const actions = {
      ...recorded.actions,
      incidents: () => Promise.resolve([ordersSlow]),
      include: (...args: Parameters<typeof recorded.actions.include>) => {
        calls.push(["include", ...args])
        return recorded.actions.include(...args)
      },
    }
    const page = mount(() => <ErrorList service="storefront" window={{ range: "1h" }} />, { actions })
    await page.settle()
    page.click(page.button(/order ‹n› lost/))
    await page.settle()
    page.click(page.button("Include this error…"))
    page.click(page.button("Include in Orders slow"))
    await page.settle()
    expect(calls).toEqual([
      ["include", "i1", { kind: "errors", environment: "production", service: "storefront", group: groups.groups[0] }],
    ])
  })

  test("a chart goes as its service, panel and the range on screen, which the server reads again", async () => {
    const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = []
    const recorded = recording()
    const actions = {
      ...recorded.actions,
      incidents: () => Promise.resolve([ordersSlow]),
      include: (...args: Parameters<typeof recorded.actions.include>) => {
        calls.push(["include", ...args])
        return recorded.actions.include(...args)
      },
    }
    const series = { now: 1, points: [1, 2] }
    const hour = { requests: series, errors: series, p99: series, stats: [{ title: "Queue", series }] }
    const page = mount(
      () => <Load name="storefront" hour={hour} read={() => Promise.resolve(undefined)} alerts={[]} />,
      { actions },
    )
    await page.settle()
    expect(page.container.querySelectorAll(".chart .plain-button")).toHaveLength(4)
    page.click(page.button("Include…", 1))
    page.click(page.button("Include in Orders slow"))
    await page.settle()
    page.click(page.button("Include…", 3))
    page.click(page.button("Include in Orders slow"))
    await page.settle()
    const range = { from: new Date(now - 3_600_000).toISOString(), to: new Date(now).toISOString() }
    expect(calls).toEqual([
      ["include", "i1", { kind: "chart", environment: "production", service: "storefront", panel: "errors", ...range }],
      ["include", "i1", { kind: "chart", environment: "production", service: "storefront", panel: "Queue", ...range }],
    ])
  })

  test("a chart from a past firing goes over the window around it", async () => {
    const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = []
    const recorded = recording()
    const actions = {
      ...recorded.actions,
      incidents: () => Promise.resolve([ordersSlow]),
      include: (...args: Parameters<typeof recorded.actions.include>) => {
        calls.push(["include", ...args])
        return recorded.actions.include(...args)
      },
    }
    const firing = {
      environment: "production",
      startsAt: "2026-10-03T09:00:00Z",
      endsAt: "2026-10-03T09:30:00Z",
    } as PastFiring
    const page = mount(() => <LoadThen service="storefront" firing={firing} />, { actions })
    await page.settle()
    expect(page.container.querySelectorAll(".chart .plain-button")).toHaveLength(3)
    page.click(page.button("Include…", 1))
    page.click(page.button("Include in Orders slow"))
    await page.settle()
    expect(calls).toEqual([
      [
        "include",
        "i1",
        {
          kind: "chart",
          environment: "production",
          service: "storefront",
          panel: "errors",
          from: "2026-10-03T08:00:00.000Z",
          to: "2026-10-03T10:30:00.000Z",
        },
      ],
    ])
  })

  test("a trace goes by its id and journey, and is not offered where only operators read logs", async () => {
    const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = []
    const recorded = recording()
    const actions = {
      ...recorded.actions,
      incidents: () => Promise.resolve([ordersSlow]),
      include: (...args: Parameters<typeof recorded.actions.include>) => {
        calls.push(["include", ...args])
        return recorded.actions.include(...args)
      },
    }
    const page = mount(() => <TracePage id="t1" journey="order" />, { actions })
    await page.settle()
    page.click(page.button("Include this trace…"))
    page.click(page.button("Include in Orders slow"))
    await page.settle()
    expect(calls).toEqual([["include", "i1", { kind: "trace", environment: "production", id: "t1", journey: "order" }]])
    const viewer = { ...operator, role: "viewer" as const, logsForOperators: true }
    const withheld = mount(() => <TracePage id="t1" journey="order" />, { actions, me: viewer })
    await withheld.settle()
    expect(withheld.container.textContent).not.toContain("Include this trace")
  })
})
