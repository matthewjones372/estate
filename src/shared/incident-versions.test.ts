import { describe, expect, test } from "bun:test"
import { versionsOf } from "./incident-versions"
import { type EventKind, seenLive } from "./timeline"

const at = (minute: number) => `2026-10-12T14:${String(minute).padStart(2, "0")}:00.000Z`
const event = (minute: number, kind: EventKind, text: string, service: string) => ({
  ...seenLive({ id: `${minute}`, at: at(minute), by: "Estate", kind, text }),
  service,
})

const services = [
  { name: "storefront", repository: "github:example/storefront" },
  { name: "orders", links: { compare: "https://git.example/orders/compare/{from}..{to}" } },
  { name: "payments" },
]

describe("what changed around an incident", () => {
  test("is each service's version at its start, its changes, and at its close, with a link to compare them", () => {
    const events = [
      event(0, "version-seen", "storefront 1.41.2 running in staging", "storefront"),
      event(0, "version-seen", "orders 1.8.0 running in staging", "orders"),
      event(5, "deployed", "storefront 1.41.2 → 1.42.0 in staging", "storefront"),
      event(9, "deployed", "orders 1.8.0 → 1.7.3 in staging, rolled back", "orders"),
      event(30, "version-seen", "storefront 1.42.0 running in staging", "storefront"),
      event(30, "version-seen", "orders 1.7.3 running in staging", "orders"),
    ]
    expect(versionsOf(events, ["storefront", "orders", "payments"], services)).toEqual([
      {
        service: "storefront",
        environment: "staging",
        start: "1.41.2",
        changes: [{ at: at(5), from: "1.41.2", to: "1.42.0", rolledBack: false }],
        close: "1.42.0",
        compare: "https://github.com/example/storefront/compare/1.41.2...1.42.0",
      },
      {
        service: "orders",
        environment: "staging",
        start: "1.8.0",
        changes: [{ at: at(9), from: "1.8.0", to: "1.7.3", rolledBack: true }],
        close: "1.7.3",
        compare: "https://git.example/orders/compare/1.8.0..1.7.3",
      },
      { service: "payments", changes: [] },
    ])
  })

  test("says a version before a deploy in its window is not known, and links nothing to compare from", () => {
    const events = [
      event(0, "version-seen", "the version of storefront before 1.42.0 is not known here", "storefront"),
      event(5, "deployed", "storefront 1.42.0 deployed in staging", "storefront"),
    ]
    expect(versionsOf(events, ["storefront"], services)).toEqual([
      {
        service: "storefront",
        environment: "staging",
        changes: [{ at: at(5), to: "1.42.0", rolledBack: false }],
        close: "1.42.0",
      },
    ])
  })
})
