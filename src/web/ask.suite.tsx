/** @jsxImportSource solid-js */
/** Ask AI on an alert page: run by `ask.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events, operator } from "./fixture"
import { mount } from "./harness"
import { AskAi } from "./parts/AskAi"

const alert = events.alerts.alerts[0] as Alert

describe("Ask AI on an alert", () => {
  test("says it is not configured when ai is off", () => {
    const page = mount(() => <AskAi alert={alert} />)
    expect(page.container.textContent).toContain("Ask AI is not configured")
    expect(page.container.textContent).not.toContain("Reading Estate")
  })

  test("asks the model, shows the structured answer, and can keep it as a note", async () => {
    const page = mount(() => <AskAi alert={alert} />, { me: { ...operator, ai: true } })
    expect(page.container.textContent).toContain("Estate gathers what changed")
    page.click(page.button("Ask AI"))
    await page.settle()
    await page.settle()
    expect(page.calls.some((call) => call[0] === "askAlert")).toBe(true)
    expect(page.container.textContent).toContain("Likely cause")
    expect(page.container.textContent).toContain("A recent deploy raised latency.")
    expect(page.container.textContent).toContain("Confidence")
    expect(page.container.textContent).toContain("Evidence")
    expect(page.container.textContent).toContain("Next steps")
    page.click(page.button("Keep as note"))
    await page.settle()
    expect(page.calls.some((call) => call[0] === "addNote")).toBe(true)
  })
})
