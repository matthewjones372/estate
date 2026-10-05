import { describe, expect, test } from "bun:test"
import { catalog, environment, estate } from "../fixture"
import { aroundOf } from "./around"

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const withAround = estate({
  catalog,
  environments: {
    production: environment({
      alerts: ok([
        {
          id: "a1",
          name: "OrdersSlow",
          state: "firing",
          severity: "warning",
          startsAt: "2026-10-03T11:46:00Z",
          labels: { service: "storefront" },
          summary: "Orders are slow",
        },
      ]),
      deploys: ok({ storefront: { version: "v2", ready: true, at: "2026-10-03T11:20:00Z" } }),
    }),
  },
  builds: ok({
    storefront: [
      {
        sha: "c556728aa",
        title: "Faster pages",
        status: "success",
        at: "2026-10-03T11:00:00Z",
        url: "https://github.example/run/1",
      },
    ],
  }),
})

describe("around an alert", () => {
  test("names the deploy and build in the hour before it fired", () => {
    const brief = aroundOf(withAround, "production", "a1")
    expect(brief?.service).toBe("storefront")
    expect(brief?.changed.map((each) => each.kind).sort()).toEqual(["build", "deploy"])
    expect(brief?.summaryText).toContain("deployed")
    expect(brief?.summaryText).toContain("before it fired")
    expect(brief?.depends.some((each) => each.name === "orders")).toBe(true)
    expect(brief?.runbook).toContain("storefront")
  })

  test("says when nothing changed in the hour before", () => {
    const quiet = estate({
      environments: {
        production: environment({
          alerts: ok([
            {
              id: "a1",
              name: "OrdersSlow",
              state: "firing",
              severity: "warning",
              startsAt: "2026-10-03T11:46:00Z",
              labels: { service: "storefront" },
            },
          ]),
          deploys: ok({}),
        }),
      },
      builds: ok({}),
    })
    const brief = aroundOf(quiet, "production", "a1")
    expect(brief?.summaryText).toContain("No deploys or builds")
  })

  test("is missing when the alert is not there", () => {
    expect(aroundOf(withAround, "production", "nope")).toBeUndefined()
  })

  test("includes earlier firings and their notes in the brief", () => {
    const withHistory = estate({
      environments: {
        production: environment({
          alerts: ok([
            {
              id: "a1",
              name: "OrdersSlow",
              state: "firing",
              severity: "warning",
              startsAt: "2026-10-03T11:46:00Z",
              labels: { service: "storefront" },
            },
          ]),
        }),
      },
      firings: [
        {
          environment: "production",
          alert: "a1",
          name: "OrdersSlow",
          startsAt: "2026-09-27T10:00:00Z",
          endsAt: "2026-09-27T10:22:00Z",
        },
      ],
      notes: [
        {
          id: "n1",
          environment: "production",
          alert: "a1",
          at: "2026-09-27T10:10:00Z",
          by: "ada",
          text: "vacuumed the orders table",
        },
      ],
    })
    const brief = aroundOf(withHistory, "production", "a1")
    expect(brief?.before[0]?.notes[0]?.text).toContain("vacuumed")
    expect(brief?.summaryText).toContain("Before")
  })
})
