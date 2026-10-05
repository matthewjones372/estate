import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"

const as = (role: "viewer" | "operator") => settings({ anonymous: { name: "gil", role } })
const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const withAlert = estate({
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

describe("GET /api/alerts/:id/around", () => {
  test("returns the brief for a firing alert", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("viewer"), withAlert)
        return yield* ask(server, new Request("http://estate/api/alerts/a1/around?env=production"))
      }),
    ).then((answer) => {
      expect(answer.status).toBe(200)
      const body = answer.json() as { summaryText: string; changed: ReadonlyArray<{ kind: string }> }
      expect(body.summaryText).toContain("deployed")
      expect(body.changed.some((each) => each.kind === "deploy")).toBe(true)
    }))

  test("is 404 for a missing alert or environment", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("viewer"), withAlert)
        return [
          yield* ask(server, new Request("http://estate/api/alerts/nope/around?env=production")),
          yield* ask(server, new Request("http://estate/api/alerts/a1/around?env=nowhere")),
        ].map((each) => each.status)
      }),
    ).then((statuses) => expect(statuses).toEqual([404, 404])))
})
