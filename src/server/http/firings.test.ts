import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import type { EstateState, StoredFiring } from "../state"

const firing = (startsAt: string, endsAt?: string): StoredFiring => ({
  environment: "production",
  alert: "a1",
  name: "OrdersSlow",
  service: "orders",
  severity: "critical",
  summary: "p99 over 2s",
  startsAt,
  ...(endsAt === undefined ? {} : { endsAt }),
})

const note = (id: string, at: string, alert = "a1") => ({
  id,
  environment: "production",
  alert,
  at,
  by: "ada",
  text: id,
})

const state = (): EstateState =>
  estate({
    catalog: { ...catalog, alerts: { OrdersSlow: { impact: "Orders take seconds to place." } } },
    firings: [
      { ...firing("2026-10-06T09:00:00Z", "2026-10-06T09:22:00Z"), silence: { by: "gil", reason: "vacuum" } },
      firing("2026-10-01T14:02:00Z", "2026-10-01T14:05:00Z"),
      firing("2026-10-07T08:00:00Z"),
      { ...firing("2026-10-06T09:00:00Z"), environment: "staging" },
    ],
    notes: [
      note("during", "2026-10-06T09:10:00Z"),
      note("later during", "2026-10-06T09:15:00Z"),
      note("after", "2026-10-06T09:30:00Z"),
      note("other alert", "2026-10-06T09:10:00Z", "a2"),
    ],
  })

const asked = (path: string) =>
  Effect.runPromise(
    Effect.flatMap(serverFor(settings({ anonymous: { name: "gil", role: "viewer" } }), state()), (server) =>
      ask(server, new Request(path)),
    ),
  )

describe("GET /api/firings/:id", () => {
  test("is one past firing: what it said, its silence, the notes written while it fired, its impact, its others", () =>
    asked("http://estate/api/firings/a1?env=production&at=2026-10-06T09:00:00Z").then((answer) => {
      expect(answer.status).toBe(200)
      expect(answer.json()).toEqual({
        environment: "production",
        alert: "a1",
        name: "OrdersSlow",
        service: "orders",
        severity: "critical",
        summary: "p99 over 2s",
        startsAt: "2026-10-06T09:00:00Z",
        endsAt: "2026-10-06T09:22:00Z",
        silence: { by: "gil", reason: "vacuum" },
        notes: [
          { id: "later during", at: "2026-10-06T09:15:00Z", by: "ada", text: "later during" },
          { id: "during", at: "2026-10-06T09:10:00Z", by: "ada", text: "during" },
        ],
        impact: { text: "Orders take seconds to place.", from: "catalog" },
        others: ["2026-10-07T08:00:00Z", "2026-10-01T14:02:00Z"],
      })
    }))

  test("finds a firing by its start however the time is written", () =>
    asked("http://estate/api/firings/a1?env=production&at=2026-10-06T09:00:00.000Z").then((answer) =>
      expect(answer.status).toBe(200),
    ))

  test("is not found once swept, or for a time or environment it never fired in, and needs its start", () =>
    Promise.all([
      asked("http://estate/api/firings/a1?env=production&at=2026-09-01T00:00:00Z"),
      asked("http://estate/api/firings/a1?env=nowhere&at=2026-10-06T09:00:00Z"),
      asked("http://estate/api/firings/a1?env=production"),
    ]).then(([swept, nowhere, unsaid]) => {
      expect(swept.status).toBe(404)
      expect(nowhere.status).toBe(404)
      expect(unsaid.status).toBe(400)
    }))
})
