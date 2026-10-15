/** @jsxImportSource solid-js */
/** What happened, written on an incident's page, and the marks on what was written or rebuilt: run by its `.test.ts`. */
import { describe, expect, test } from "bun:test"
import type { Me } from "../shared/events"
import { seenLive } from "../shared/timeline"
import { operator } from "./fixture"
import { mount } from "./harness"
import { IncidentPage } from "./pages/Incident"
import { recording } from "./recording"

const viewer: Me = { ...operator, role: "viewer" }

const opened = async (id: string, me: Me = operator) => {
  const page = mount(() => <IncidentPage id={id} />, { me })
  await page.settle()
  return page
}

describe("what happened, on an incident's page", () => {
  test("marks what a person wrote and what Estate rebuilt, with when each was kept", async () => {
    const { actions } = recording()
    const kept = [
      seenLive({ id: "x", at: "2026-10-03T11:41:00Z", by: "Estate", kind: "restarted", text: "orders-1 restarted" }),
      {
        ...seenLive({ id: "w", at: "2026-10-03T11:45:00Z", by: "gil", kind: "happened", text: "Rolled back by hand" }),
        recordedAt: "2026-10-03T11:58:00Z",
        source: "written",
      },
      {
        ...seenLive({ id: "r", at: "2026-10-03T11:20:00Z", by: "Estate", kind: "deployed", text: "orders 2.1.0" }),
        recordedAt: "2026-10-03T11:50:00Z",
        source: "rebuilt",
      },
    ] as const
    const page = mount(() => <IncidentPage id="i1" />, {
      actions: {
        ...actions,
        incident: (id) =>
          actions.incident(id).then((found) => (typeof found === "object" ? { ...found, events: kept } : found)),
      },
    })
    await page.settle()
    const marks = [...page.container.querySelectorAll(".timeline-source")]
    expect(marks.map((each) => each.getAttribute("title"))).toEqual([
      "written by gil, kept 2026-10-03 11:58:00 UTC",
      "rebuilt by Estate from what it held, kept 2026-10-03 11:50:00 UTC",
    ])
    expect(marks[0]?.textContent).toMatch(/^written \d\d:58 ✎$/)
    expect(marks[1]?.textContent).toBe("rebuilt ↺")
  })

  test("anyone who may write adds what happened, at the time it happened", async () => {
    const page = await opened("i1", viewer)
    const form = page.container.querySelector(".incident-happened") as HTMLElement
    page.type(form.querySelector('input[type="text"]') as HTMLInputElement, " Rolled back by hand ")
    page.type(form.querySelector('input[type="datetime-local"]') as HTMLInputElement, "2026-10-03T11:45")
    page.click(page.button("Add what happened"))
    await page.settle()
    expect(page.calls).toContainEqual([
      "addIncidentHappened",
      "i1",
      "Rolled back by hand",
      new Date("2026-10-03T11:45").toISOString(),
    ])
    expect(page.calls.filter(([name]) => name === "incident")).toHaveLength(2)
    expect((form.querySelector('input[type="text"]') as HTMLInputElement).value).toBe("")
  })

  test("a screen may not add what happened", async () => {
    expect((await opened("i1", { ...operator, kiosk: true })).container.querySelector(".incident-happened")).toBeNull()
  })
})
