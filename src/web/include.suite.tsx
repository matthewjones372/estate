/** @jsxImportSource solid-js */
/** *Include in incident* on what the page shows (spec 0051): run by `include.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Me } from "../shared/events"
import type { Incident } from "../shared/incidents"
import { operator } from "./fixture"
import { groups } from "./fixture-logs"
import { mount } from "./harness"
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
})
