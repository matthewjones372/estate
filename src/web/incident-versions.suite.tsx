/** @jsxImportSource solid-js */
/** *What changed* on an incident's page: run by its `.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { mount } from "./harness"
import { IncidentPage } from "./pages/Incident"
import { recording } from "./recording"

describe("what changed around an incident, on its page", () => {
  test("says what changed: each service's version at its start, during it and now, with a link to compare", async () => {
    const { actions } = recording()
    const versions = [
      {
        service: "storefront",
        environment: "production",
        start: "1.41.2",
        changes: [{ at: "2026-10-03T11:44:00Z", from: "1.41.2", to: "1.42.0", rolledBack: false }],
        close: "1.42.0",
        compare: "https://github.com/example/storefront/compare/1.41.2...1.42.0",
      },
      { service: "payments", changes: [] },
    ]
    const page = mount(() => <IncidentPage id="i1" />, {
      actions: {
        ...actions,
        incident: (id) =>
          actions.incident(id).then((found) => (typeof found === "object" ? { ...found, versions } : found)),
      },
    })
    await page.settle()
    const rows = [...page.container.querySelectorAll(".incident-versions tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    )
    expect(rows[0]).toEqual([
      "storefront",
      "production",
      "1.41.2",
      expect.stringMatching(/^1\.42\.0 at \d\d:44$/),
      "1.42.0",
      "compare ↗",
    ])
    expect(rows[1]).toEqual(["payments", "No version is known for it."])
    expect(page.container.querySelector(".incident-versions a")?.getAttribute("href")).toBe(
      "https://github.com/example/storefront/compare/1.41.2...1.42.0",
    )
  })
})
