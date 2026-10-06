/** @jsxImportSource solid-js */
/** *Around this alert* on its page, and its line on the card: run by `around-ui.test.ts`. */
import { describe, expect, test } from "bun:test"
import type { AroundAlert } from "../shared/around"
import type { Alert } from "../shared/events"
import { events } from "./fixture"
import { mount, render } from "./harness"
import { Around, AroundLine } from "./parts/Around"
import { brief, recording } from "./recording"

const alert = events.alerts.alerts[0] as Alert
const text = (html: string) =>
  html
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")

describe("around an alert", () => {
  test("is gathered by the server: what changed, what it depends on, its errors and its runbook's text", async () => {
    const page = mount(() => <Around alert={alert} />)
    expect(page.container.textContent).toContain("Gathering what is around it…")
    await page.settle()
    const shown = page.container.textContent ?? ""
    expect(page.calls).toContainEqual(["around", "a1"])
    expect(shown).toContain("storefront main-88-04bc441 deployed 11:44, 2 min before it fired")
    expect(shown).toContain("orders build passed: Retry 11:50, 4 min after")
    expect(shown).toContain("orders-db calls attention · Connections used 92%: connections are high")
    expect(shown).toContain("“ERROR order ‹n› lost” ×2")
    expect(shown).toContain("If p99 is high after a deploy, roll back.")
  })

  test("says so where nothing changed, the logs failed, the runbook was not read, or it could not be gathered", async () => {
    const quiet: AroundAlert = {
      ...brief,
      changed: [],
      depends: [],
      errors: { failed: "Loki answered 500" },
      runbook: { url: "https://runbooks.example/x", failed: "it is application/pdf, not text" },
    }
    const page = mount(() => <Around alert={alert} />, {
      actions: { ...recording().actions, around: () => Promise.resolve(quiet) },
    })
    await page.settle()
    const shown = page.container.textContent ?? ""
    expect(shown).toContain("Nothing deployed or built near it.")
    expect(shown).toContain("The logs did not answer: Loki answered 500")
    expect(shown).toContain("Not read: it is application/pdf, not text. Open it")
    const clean = mount(() => <Around alert={alert} />, {
      actions: {
        ...recording().actions,
        around: () => Promise.resolve({ ...quiet, errors: { from: "Loki", groups: [] }, runbook: { url: "u" } }),
      },
    })
    await clean.settle()
    expect(clean.container.textContent).toContain("None from ten minutes before it fired, in Loki.")
    expect(clean.container.textContent).toContain("Not read. Open it")
    const gone = mount(() => <Around alert={{ ...alert, id: "a9" }} />)
    await gone.settle()
    expect(gone.container.textContent).toContain("Estate could not gather what is around it.")
  })

  test("on a card is the nearest change before it fired, or that nothing was deployed", () => {
    expect(text(render(() => <AroundLine alert={alert} />))).toContain("before it fired")
    const early = { ...alert, startsAt: "2026-10-03T08:00:00Z" }
    expect(text(render(() => <AroundLine alert={early} />))).toContain("No deploys in the hour before")
  })
})
