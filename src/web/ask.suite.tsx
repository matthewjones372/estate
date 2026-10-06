/** @jsxImportSource solid-js */
/** Ask AI on an alert's page: run by `ask.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events, operator } from "./fixture"
import { mount } from "./harness"
import { AskAi } from "./parts/AskAi"
import { recording } from "./recording"

const alert = events.alerts.alerts[0] as Alert
const asking = { ...operator, ai: true }

describe("Ask AI on an alert", () => {
  test("says it is not configured when ai is off", () => {
    const page = mount(() => <AskAi alert={alert} />)
    expect(page.container.textContent).toContain("Ask AI is not configured")
    expect(page.container.querySelector("button")).toBeNull()
  })

  test("shows the model's answer with its linked evidence and what it read, and keeps it as a note once", async () => {
    const page = mount(() => <AskAi alert={alert} />, { me: asking })
    page.click(page.button("Ask AI"))
    expect(page.container.textContent).toContain("Reading Estate…")
    await page.settle()
    const shown = page.container.textContent ?? ""
    expect(page.calls).toContainEqual(["askAlert", "a1"])
    expect(shown).toContain("Likely cause A recent deploy raised latency.")
    expect(shown).toContain("fake-model · read: Changed · Runbook")
    expect(page.container.querySelector('a[href="https://ci.example/1"]')?.textContent).toContain("deployed 26 min")
    page.click(page.button("Keep as note"))
    await page.settle()
    expect(page.calls).toContainEqual([
      "addNote",
      "a1",
      "Ask AI (fake-model): A recent deploy raised latency.\n· storefront v2 deployed 26 min before it fired\nNext: Check the runbook\nNext: Compare p99 before and after the deploy\nConfidence: medium",
    ])
    expect(page.container.textContent).toContain("Kept as a note.")
  })

  test("says why there is no answer, as an alert", async () => {
    const page = mount(() => <AskAi alert={{ ...alert, id: "a2" }} />, { me: asking })
    page.click(page.button("Ask AI"))
    await page.settle()
    expect(page.container.querySelector('[role="alert"]')?.textContent).toBe(
      "this alert was asked about less than a minute ago",
    )
  })

  test("stops its ask when the page is left", async () => {
    const signals: AbortSignal[] = []
    const page = mount(() => <AskAi alert={alert} />, {
      me: asking,
      actions: {
        ...recording().actions,
        askAlert: (_alert, signal) => {
          signals.push(signal)
          return new Promise(() => undefined)
        },
      },
    })
    page.click(page.button("Ask AI"))
    page.dispose()
    expect(signals[0]?.aborted).toBe(true)
  })
})
