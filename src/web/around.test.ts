import { describe, expect, test } from "bun:test"
import { changesNear, neighboursOf } from "./around"
import { events } from "./fixture"

describe("the line on an alert's card", () => {
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

  test("looks at the services next to it on the map", () => {
    expect(neighboursOf(events.catalog, "storefront")).toContain("orders")
  })

  test("finds nothing when there was no deploy in the hour before", () => {
    expect(changesNear("2026-10-03T08:00:00Z", "storefront", events.deploys, "production")).toEqual([])
  })
})
