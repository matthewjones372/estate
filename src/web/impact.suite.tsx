/** @jsxImportSource solid-js */
/** An alert's impact on its card, in happy-dom: run by \`impact.test.ts\` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events, operator } from "./fixture"
import { mount } from "./harness"
import { History } from "./parts/History"
import { Impact } from "./parts/Impact"

const alert = events.alerts?.alerts[0] as Alert
const viewer = { ...operator, role: "viewer" as const }
const { impact: _, ...bare } = alert

describe("an alert's impact", () => {
  test("is shown with who wrote it and when, and an operator edits it", async () => {
    const written: Alert = {
      ...alert,
      impact: { text: "Orders take minutes to place.", from: "page", by: "ada", at: "2026-10-03T11:00:00Z" },
    }
    const page = mount(() => <Impact alert={written} />)
    expect(page.container.textContent).toContain("ImpactOrders take minutes to place.ada, 1 h ago")
    page.click(page.button("Edit"))
    const input = page.container.querySelector<HTMLInputElement>(".impact-form input")
    expect(input?.value).toBe("Orders take minutes to place.")
    if (input === null) throw new Error("no input")
    page.type(input, " Orders fail. ")
    await page.settle()
    page.click(page.button("Save impact"))
    await page.settle()
    expect(page.calls).toContainEqual(["setImpact", alert.name, "Orders fail."])
  })

  test("is added by an operator where there is none, cleared when emptied, and the form can be left", async () => {
    const page = mount(() => <Impact alert={bare} />)
    page.click(page.button("Add impact"))
    await page.settle()
    expect(page.button("Clear")).toBeDefined()
    page.click(page.button("Clear"))
    await page.settle()
    expect(page.calls).toContainEqual(["setImpact", alert.name, ""])
    const left = mount(() => <Impact alert={bare} />)
    left.click(left.button("Add impact"))
    await left.settle()
    left.click(left.button("Cancel"))
    await left.settle()
    expect(left.container.textContent).toContain("Add impact")
  })

  test("from the catalog or a rule is shown without a name, and a viewer only reads it", () => {
    const ruled = { ...alert, impact: { text: "Said by the rule.", from: "rule" } } as Alert
    const page = mount(() => <Impact alert={ruled} />, { me: viewer })
    expect(page.container.textContent).toBe("ImpactSaid by the rule.")
    const none = mount(() => <Impact alert={bare} />, { me: viewer })
    expect(none.container.textContent).toBe("")
  })
})

describe("an alert that has fired before", () => {
  const before: Alert = {
    ...alert,
    history: [
      {
        startsAt: "2026-09-27T09:10:00Z",
        endsAt: "2026-09-27T09:32:00Z",
        silence: { by: "gil", reason: "indexer redeploy" },
        notes: [{ id: "n9", at: "2026-09-27T09:20:00Z", by: "ada", text: "Indexer stuck; restarted it." }],
      },
      { startsAt: "2026-09-19T14:02:00Z", notes: [] },
    ],
  }

  test("says how often and when last, quotes the last note, and opens each earlier firing", async () => {
    const page = mount(() => <History alert={before} />)
    const text = () => page.container.textContent ?? ""
    expect(text()).toContain("Before2 times, last 6 d ago for 22 min")
    expect(text()).toContain("“Indexer stuck; restarted it.” — ada, 6 d ago")
    page.click(page.button("History"))
    await page.settle()
    const firings = [...page.container.querySelectorAll(".alert-history li")].map((each) => each.textContent)
    expect(firings).toHaveLength(2)
    expect(firings[0]).toContain("22 min")
    expect(firings[0]).toContain("silenced by gil: “indexer redeploy”")
    expect(firings[1]).toContain("its end not seen")
    page.click(page.button("Hide history"))
    await page.settle()
    expect(page.container.querySelector(".alert-history")).toBeNull()
  })

  test("says once, and nothing for an alert that has not", () => {
    const once = mount(() => (
      <History alert={{ ...before, history: [{ startsAt: "2026-10-03T08:00:00Z", notes: [] }] }} />
    ))
    expect(once.container.textContent).toContain("Beforeonce, last 4 h ago")
    expect(mount(() => <History alert={bare} />).container.textContent).toBe("")
  })
})
