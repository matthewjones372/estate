import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
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

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-07T12:00:00Z" })

const state = (): EstateState =>
  estate({
    catalog: { ...catalog, alerts: { OrdersSlow: { impact: "Orders take seconds to place." } } },
    environments: {
      staging: environment(),
      production: environment({
        deploys: ok({ orders: { version: "main-88", ready: true, at: "2026-10-06T08:40:00Z" } }),
      }),
    },
    builds: ok({
      storefront: [
        { sha: "a", title: "After it", status: "success", at: "2026-10-06T09:30:00Z", url: "https://ci/2" },
        { sha: "b", title: "Faster basket", status: "success", at: "2026-10-06T08:30:00Z", url: "https://ci/1" },
        { sha: "c", title: "Long before", status: "success", at: "2026-10-06T07:00:00Z", url: "https://ci/0" },
      ],
    }),
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
        around: expect.any(Object),
      })
    }))

  test("says what changed in the hour before it fired, which deploys are no longer held, and what is around it", () =>
    Promise.all([
      asked("http://estate/api/firings/a1?env=production&at=2026-10-06T09:00:00Z"),
      asked("http://estate/api/firings/a1?env=production&at=2026-10-01T14:02:00Z"),
    ]).then(([recent, older]) => {
      expect((recent.json() as { around: unknown }).around).toEqual({
        changed: [
          { at: "2026-10-06T08:40:00Z", service: "orders", kind: "deploy", text: "main-88 deployed" },
          {
            at: "2026-10-06T08:30:00Z",
            service: "storefront",
            kind: "build",
            text: "build passed: Faster basket",
            url: "https://ci/1",
          },
        ],
        unseen: [],
        neighbours: expect.arrayContaining([{ name: "storefront", kind: "service", side: "called by" }]),
      })
      expect((older.json() as { around: unknown }).around).toMatchObject({
        changed: [],
        unseen: [{ service: "orders", version: "main-88" }],
      })
    }))

  test("finds a firing by its start however the time is written", () =>
    asked("http://estate/api/firings/a1?env=production&at=2026-10-06T09:00:00.000Z").then((answer) =>
      expect(answer.status).toBe(200),
    ))

  test("is not found once swept, or for a time or environment it never fired in; without a start, the latest", () =>
    Promise.all([
      asked("http://estate/api/firings/a1?env=production&at=2026-09-01T00:00:00Z"),
      asked("http://estate/api/firings/a1?env=nowhere&at=2026-10-06T09:00:00Z"),
      asked("http://estate/api/firings/a1?env=production"),
    ]).then(([swept, nowhere, unsaid]) => {
      expect(swept.status).toBe(404)
      expect(nowhere.status).toBe(404)
      expect(unsaid.json()).toMatchObject({ startsAt: "2026-10-07T08:00:00Z" })
    }))
})
