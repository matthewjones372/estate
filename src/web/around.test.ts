import { describe, expect, test } from "bun:test"
import { changesNear, neighboursOf } from "./around"
import { events } from "./fixture"

describe("around an alert on the page", () => {
  test("finds storefront's deploy and build in the hour before OrdersSlow fired", () => {
    const changes = changesNear(
      "2026-10-03T11:46:00Z",
      "storefront",
      events.deploys,
      "production",
      neighboursOf(events.catalog, "storefront"),
    )
    expect(changes.some((each) => each.kind === "deploy" && each.service === "storefront")).toBe(true)
    expect(changes.some((each) => each.kind === "build")).toBe(true)
  })

  test("names map neighbours", () => {
    expect(neighboursOf(events.catalog, "storefront")).toContain("orders")
  })

  test("says nothing when there was no deploy in the hour before", () => {
    expect(changesNear("2026-10-03T08:00:00Z", "storefront", events.deploys, "production")).toEqual([])
  })
})
