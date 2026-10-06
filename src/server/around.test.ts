import { describe, expect, test } from "bun:test"
import type { AroundAlert } from "../shared/around"
import { briefText, sectionsOf } from "./around"

const around: AroundAlert = {
  alert: "a1",
  name: "OrdersSlow",
  startsAt: "2026-10-03T11:00:00Z",
  summary: "Orders are slow to place",
  impact: "Customers wait to place orders.",
  subject: "orders",
  changed: [{ at: "2026-10-03T11:04:00Z", service: "orders", kind: "deploy", text: "main-89 deployed" }],
  depends: [
    {
      name: "orders-db",
      kind: "store",
      side: "calls",
      health: "attention",
      reasons: ["connections are high"],
      readings: [{ title: "connections", now: null, unit: "%" }],
    },
  ],
  errors: { failed: "Loki answered 500" },
  before: [
    {
      startsAt: "2026-09-27T09:10:00Z",
      endsAt: "2026-09-27T09:32:00Z",
      silence: { by: "gil", reason: "provider outage" },
      notes: [{ by: "ada", at: "2026-09-27T09:20:00Z", text: "vacuumed the orders table" }],
    },
  ],
  runbook: { url: "https://wiki.example/orders", failed: "it is application/pdf, not text" },
}

describe("an alert's brief as a model reads it", () => {
  test("says each part under its name, with times relative to when it fired", () =>
    expect(briefText(around)).toBe(
      [
        "Alert OrdersSlow, firing since 2026-10-03T11:00:00Z, about orders.",
        "Summary: Orders are slow to place",
        "Impact: Customers wait to place orders.",
        "Changed in the hour before it fired, and since:",
        "- orders: main-89 deployed, 4 min after",
        "Depends:",
        "- orders-db (store, calls): attention; connections –%; connections are high",
        "Errors since ten minutes before it fired:",
        "- the logs did not answer: Loki answered 500",
        "Fired before:",
        '- 2026-09-27T09:10:00Z for 22 min; silenced by gil: provider outage; "vacuumed the orders table" (ada)',
        "Runbook: https://wiki.example/orders (not read)",
      ].join("\n"),
    ))

  test("names only the parts that have something in them", () => {
    expect(sectionsOf(around)).toEqual(["Changed", "Depends", "Before"])
    expect(
      sectionsOf({
        ...around,
        depends: [],
        before: [],
        errors: { from: "Loki", groups: [] },
        runbook: { url: "u", text: "roll back" },
      }),
    ).toEqual(["Changed", "Errors", "Runbook"])
  })
})
