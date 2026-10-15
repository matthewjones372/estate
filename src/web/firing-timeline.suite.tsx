/** @jsxImportSource solid-js */
/** A firing's timeline on its pages: run by `firing-timeline.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { AlertPage } from "./pages/Alert"
import { FiringPage } from "./pages/Firing"
import { FiringTimeline } from "./parts/FiringTimeline"

const rows = (container: HTMLElement) =>
  [...container.querySelectorAll(".timeline li")].map((row) => row.textContent?.replace(/\s+/g, " ").trim())

describe("a firing's timeline", () => {
  test("lists what happened in order, each with its date and time to the second and who did it", async () => {
    const page = mount(() => <FiringTimeline alert="a1" startsAt="2026-10-02T09:00:00Z" />)
    await page.settle()
    expect(page.calls).toContainEqual(["events", "a1", "2026-10-02T09:00:00Z"])
    const shown = rows(page.container)
    expect(shown).toHaveLength(6)
    expect(shown[0]).toMatch(/^2 Oct \d\d:00:00 Estate fired: OrdersSlow, critical, storefront$/)
    expect(shown[1]).toMatch(/:05:30 gil asked AI \(claude-haiku-4-5\)$/)
    expect(shown[2]).toMatch(/:06:02 Estate AI answered: The pool is exhausted\. \(medium\)$/)
    expect(shown[3]).toMatch(/:07:00 gil silenced for 1 hour: vacuum$/)
    expect(shown[4]).toMatch(/:12:45 ada told Orders on Slack$/)
    expect(shown[5]).toMatch(/:22:00 Estate resolved after 22 min$/)
    expect(page.container.querySelector(".timeline time")?.getAttribute("title")).toBe("2026-10-02 09:00:00 UTC")
    expect(page.container.querySelector('.timeline a[href="https://slack.example/p1"]')?.textContent).toBe(
      "told Orders on Slack",
    )
  })

  test("says what was done to the incidents a firing was part of", async () => {
    const page = mount(() => <FiringTimeline alert="a3" startsAt="2026-10-02T09:00:00Z" />)
    await page.settle()
    const shown = rows(page.container)
    expect(shown).toHaveLength(4)
    expect(shown[0]).toMatch(/:01:00 gil opened incident "Orders slow" with this firing$/)
    expect(shown[1]).toMatch(/:02:00 gil unlinked from incident "Orders slow"$/)
    expect(shown[2]).toMatch(/:02:00 gil linked to incident "Checkout down"$/)
    expect(shown[3]).toMatch(/:30:00 ada closed the incident: the pool was resized$/)
  })

  test("says when nothing is kept, and when it could not be read", async () => {
    const quiet = mount(() => <FiringTimeline alert="a2" startsAt="2026-10-02T09:00:00Z" />)
    await quiet.settle()
    expect(quiet.container.textContent).toContain("Nothing is kept for this firing yet.")
    const broken = mount(() => <FiringTimeline alert="broken" startsAt="2026-10-02T09:00:00Z" />)
    await broken.settle()
    expect(broken.container.textContent).toContain("The timeline could not be read.")
  })

  test("is on an alert's own page and on a past firing's page", async () => {
    const live = mount(() => <AlertPage id="a1" />)
    await live.settle()
    expect(live.container.querySelector("#alert-timeline")?.textContent).toBe("Timeline")
    const past = mount(() => <FiringPage id="a1" at="2026-10-02T09:00:00Z" />)
    await past.settle()
    expect(past.container.querySelector("#firing-timeline")?.textContent).toBe("Timeline")
    expect(rows(past.container)).toHaveLength(6)
  })
})
