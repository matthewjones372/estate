/** @jsxImportSource solid-js */
/** The header, on one row (spec 0068): run by `header.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { mount } from "./harness"
import { Header } from "./parts/Header"

const incident = { id: "i1", title: "Orders late", closed: false, openedAt: "2026-10-03T11:50:00Z" }

describe("the header", () => {
  test("counts what fires on Alerts and the incidents it fires in on Incidents", () => {
    const [first, ...rest] = events.alerts.alerts
    if (first === undefined) throw new Error("no alert")
    const sent = {
      ...events,
      alerts: {
        ...events.alerts,
        alerts: [{ ...first, incident }, { ...first, id: "a9", incident }, ...rest],
      },
    }
    const page = mount(() => <Header />, { sent })
    const counts = [...page.container.querySelectorAll(".nav a")].map((link) => link.textContent?.trim())
    expect(counts).toEqual(["Overview", "Deploys", "Alerts 2", "Incidents 1"])
    const quiet = mount(() => <Header />)
    expect([...quiet.container.querySelectorAll(".nav a")].at(-1)?.textContent?.trim()).toBe("Incidents")
  })

  test("says who you are behind your initials, with Sign out", () => {
    const page = mount(() => <Header />)
    const account = page.container.querySelector<HTMLButtonElement>(".avatar-button")
    expect(account?.querySelector(".visually-hidden")?.textContent).toBe("Account: ada lovelace · operator")
    expect(account?.getAttribute("popovertarget")).toBe("account")
    expect(page.container.querySelector("#account")?.textContent).toContain("Sign out")
  })
})
