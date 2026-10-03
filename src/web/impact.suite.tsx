/** @jsxImportSource solid-js */
/** An alert's impact on its card, in happy-dom: run by \`impact.test.ts\` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events, operator } from "./fixture"
import { mount } from "./harness"
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
