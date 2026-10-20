import { describe, expect, test } from "bun:test"
import { pageOf, pathOf } from "./route"

describe("a service page's address", () => {
  test("says which logs are shown, and over what", () => {
    expect(pageOf("/services/checkout", "?env=production&logs=errors&range=24h")).toEqual({
      page: "service",
      name: "checkout",
      logs: { view: "errors", range: "24h" },
    })
    expect(pageOf("/services/checkout", "?logs=errors")).toEqual({
      page: "service",
      name: "checkout",
      logs: { view: "errors", range: "1h" },
    })
  })

  test("shows the live lines over the last hour when it says nothing, or nothing Estate knows", () => {
    expect(pageOf("/services/checkout", "?env=production")).toEqual({ page: "service", name: "checkout" })
    expect(pageOf("/services/checkout", "?logs=everything&range=1y")).toEqual({ page: "service", name: "checkout" })
  })

  test("is written back as it was read, leaving out what is shown anyway", () => {
    expect(pathOf({ page: "service", name: "checkout", logs: { view: "errors", range: "24h" } })).toBe(
      "/services/checkout?logs=errors&range=24h",
    )
    expect(pathOf({ page: "service", name: "checkout", logs: { view: "live", range: "1h" } })).toBe(
      "/services/checkout",
    )
  })
})
