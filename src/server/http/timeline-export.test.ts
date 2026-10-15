import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer, Schema } from "effect"
import type { Incident } from "../../shared/incidents"
import { seenLive } from "../../shared/timeline"
import { TimelineExport } from "../../shared/timeline-export"
import { ask, environment, estate, type Server, serverFor, settings } from "../fixture"
import { memoryNotes, Notes, type StoredEvent } from "../notes"
import type { Settings } from "../settings"
import { SourceFailure } from "../sources/run"
import type { SourcedAlert, StoredFiring } from "../state"

const live: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  summary: "Orders are slow",
  startsAt: "2026-10-02T09:00:00Z",
  labels: { alertname: "OrdersSlow", service: "orders" },
}
const past: StoredFiring = {
  environment: "production",
  alert: "a9",
  name: "PaymentsDown",
  service: "payments",
  severity: "critical",
  startsAt: "2026-10-02T08:58:00Z",
  endsAt: "2026-10-02T09:20:00Z",
}
const incident: Incident = {
  id: "i1",
  title: "Orders: slow | payments down",
  openedBy: "gil",
  openedAt: "2026-10-02T09:01:00Z",
  closedBy: "ada",
  closedAt: "2026-10-02T09:30:00Z",
  ended: "the pool was resized",
  firings: [
    {
      environment: "staging",
      alert: "a1",
      name: "OrdersSlow",
      startsAt: live.startsAt,
      linkedBy: "gil",
      linkedAt: "x",
    },
    { environment: "production", alert: "a9", startsAt: past.startsAt, linkedBy: "ada", linkedAt: "x" },
  ],
}
const kept = estate({
  environments: { staging: environment({ alerts: { state: "ok", value: [live] } }), production: environment() },
  firings: [past],
  incidents: [incident],
  impacts: [{ alert: "OrdersSlow", text: "Orders take seconds to place.", by: "gil", at: "2026-10-02T09:03:00Z" }],
  notes: [
    { id: "n0", environment: "staging", alert: "a1", at: "2026-10-01T10:00:00Z", by: "gil", text: "an older firing's" },
    {
      id: "n1",
      environment: "staging",
      alert: "a1",
      at: "2026-10-02T09:04:00Z",
      by: "ada",
      text: "Restarted.\nWatching",
    },
    { id: "n2", environment: "staging", alert: "a1", at: "2026-10-02T09:02:00Z", by: "gil", text: "Pool at 100%" },
    { id: "n3", environment: "production", alert: "a9", at: "2026-10-02T09:05:00Z", by: "ada", text: "Card fees down" },
  ],
})
const operator = settings({ anonymous: { name: "gil", role: "operator" }, logs: "operator" })
const viewer = settings({ anonymous: { name: "vi", role: "viewer" }, logs: "operator" })

const event =
  (on: { environment: string; alert: string; startsAt: string }, id: string, at: string) =>
  (more: Partial<StoredEvent>): StoredEvent => ({
    ...seenLive({ ...on, id, at, by: "gil", kind: "noted", text: id }),
    ...more,
  })
const orders = { environment: "staging", alert: "a1", startsAt: live.startsAt }
const payments = { environment: "production", alert: "a9", startsAt: past.startsAt }

/** A server with both firings' events, added out of order. */
const seeded = (configured: Settings) =>
  Effect.gen(function* () {
    const server = yield* serverFor(configured, kept)
    const notes = Context.get(server.context, Notes)
    yield* Effect.forEach(
      [
        event(orders, "e3", "2026-10-02T09:02:00.000Z")({ text: "Pool | at 100%\nsecond line" }),
        event(orders, "e1", "2026-10-02T09:00:00.000Z")({ by: "Estate", kind: "fired", text: "warning, orders" }),
        event(orders, "e4", "2026-10-02T09:03:30Z")({ kind: "team-told", text: "told Orders", link: "https://s/p1" }),
        event(payments, "e2", "2026-10-02T09:01:30Z")({ by: "ada", kind: "incident-linked", text: incident.title }),
        event(payments, "e5", "2026-10-02T09:20:00Z")({ by: "Estate", kind: "resolved", text: "after 22 min" }),
      ],
      (each) => notes.addEvent(each),
    )
    return server
  })

const get = (server: Server, path: string) => ask(server, new Request(`http://estate${path}`))

const rows = (markdown: string) => markdown.split("\n").filter((line) => /^\| \d/.test(line))

describe("GET /api/firings/:id/timeline", () => {
  test("is the firing as Markdown: its header, its UTC table in order, escaped, and its notes in full", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* seeded(operator)
        return {
          live: yield* get(server, "/api/firings/a1/timeline?env=staging"),
          written: yield* get(server, "/api/firings/a1/timeline?env=staging&at=2026-10-02T09:00:00.000Z&format=md"),
        }
      }),
    ).then(({ live, written }) => {
      expect(live.status).toBe(200)
      expect(live.headers.get("content-type")).toBe("text/markdown; charset=utf-8")
      expect(live.headers.get("content-disposition")).toBe('attachment; filename="OrdersSlow-2026-10-02T0900Z.md"')
      expect(written.text).toBe(live.text)
      const markdown = live.text
      expect(markdown.split("\n").slice(0, 10)).toEqual([
        "# OrdersSlow",
        "",
        "- **Service:** orders",
        "- **Environment:** staging",
        "- **Fired:** 2026-10-02T09:00:00Z",
        "- **Resolved:** still firing",
        "- **Severity:** warning",
        "- **Summary:** Orders are slow",
        "- **Impact:** Orders take seconds to place.",
        "",
      ])
      expect(markdown).toContain("| At (UTC) | Who | What |\n| --- | --- | --- |\n")
      expect(rows(markdown)).toEqual([
        "| 2026-10-02T09:00:00Z | Estate | fired: warning, orders |",
        "| 2026-10-02T09:02:00Z | gil | noted: Pool \\| at 100%<br>second line |",
        "| 2026-10-02T09:03:30Z | gil | told Orders (<https://s/p1>) |",
      ])
      expect(markdown).toContain(
        "## Notes\n\n**gil**, 2026-10-02T09:02:00Z\n\n> Pool at 100%\n\n**ada**, 2026-10-02T09:04:00Z\n\n> Restarted.\n> Watching\n",
      )
      expect(markdown).not.toContain("an older firing's")
    }))

  test("is the same as JSON, decoded by the shared schema; a firing not kept is a 404", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* seeded(operator)
        return {
          read: yield* get(server, "/api/firings/a9/timeline?env=production&at=2026-10-02T08:58:00Z&format=json"),
          missing: yield* get(server, "/api/firings/a7/timeline?env=staging"),
          wrong: yield* get(server, "/api/firings/a1/timeline?env=staging&format=pdf"),
        }
      }),
    ).then(({ read, missing, wrong }) => {
      expect(read.headers.get("content-type")).toBe("application/json")
      expect(read.headers.get("content-disposition")).toBe('attachment; filename="PaymentsDown-2026-10-02T0858Z.json"')
      const decoded = Schema.decodeUnknownSync(TimelineExport)(read.json())
      expect(decoded.title).toBe("PaymentsDown")
      expect(decoded.firings).toEqual([
        {
          environment: "production",
          alert: "a9",
          name: "PaymentsDown",
          service: "payments",
          severity: "critical",
          startsAt: past.startsAt,
          endsAt: "2026-10-02T09:20:00Z",
          firing: false,
          notes: [{ id: "n3", at: "2026-10-02T09:05:00Z", by: "ada", text: "Card fees down" }],
        },
      ])
      expect(decoded.events.map((each) => [each.at, each.kind])).toEqual([
        ["2026-10-02T09:01:30Z", "incident-linked"],
        ["2026-10-02T09:20:00Z", "resolved"],
      ])
      expect(missing.status).toBe(404)
      expect(wrong.status).toBe(400)
    }))
})

describe("GET /api/incidents/:id/timeline", () => {
  test("is the incident as Markdown: who opened and closed it, each firing, the merged table and each one's notes", () =>
    Effect.runPromise(Effect.flatMap(seeded(operator), (server) => get(server, "/api/incidents/i1/timeline"))).then(
      (read) => {
        expect(read.headers.get("content-type")).toBe("text/markdown; charset=utf-8")
        expect(read.headers.get("content-disposition")).toBe(
          'attachment; filename="Orders-slow-payments-down-2026-10-02T0901Z.md"',
        )
        const markdown = read.text
        expect(markdown.split("\n").slice(0, 5)).toEqual([
          "# Orders: slow | payments down",
          "",
          "- **Opened:** by gil, 2026-10-02T09:01:00Z",
          "- **Closed:** by ada, 2026-10-02T09:30:00Z: the pool was resized",
          "",
        ])
        expect(markdown).toContain(
          "### PaymentsDown\n\n- **Service:** payments\n- **Environment:** production\n- **Fired:** 2026-10-02T08:58:00Z\n- **Resolved:** 2026-10-02T09:20:00Z\n- **Severity:** critical\n",
        )
        expect(markdown).toContain("| At (UTC) | Who | Alert | What |")
        expect(rows(markdown)).toEqual([
          "| 2026-10-02T09:00:00Z | Estate | OrdersSlow | fired: warning, orders |",
          '| 2026-10-02T09:01:30Z | ada | PaymentsDown | linked to incident "Orders: slow \\| payments down" |',
          "| 2026-10-02T09:02:00Z | gil | OrdersSlow | noted: Pool \\| at 100%<br>second line |",
          "| 2026-10-02T09:03:30Z | gil | OrdersSlow | told Orders (<https://s/p1>) |",
          "| 2026-10-02T09:20:00Z | Estate | PaymentsDown | resolved after 22 min |",
        ])
        expect(markdown).toContain("### OrdersSlow, staging\n\n**gil**, 2026-10-02T09:02:00Z\n\n> Pool at 100%\n")
        expect(markdown).toContain(
          "### PaymentsDown, production\n\n**ada**, 2026-10-02T09:05:00Z\n\n> Card fees down\n",
        )
      },
    ))

  test("is the same as JSON, and an unknown incident is a 404", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* seeded(operator)
        return {
          read: yield* get(server, "/api/incidents/i1/timeline?format=json"),
          missing: yield* get(server, "/api/incidents/i7/timeline"),
        }
      }),
    ).then(({ read, missing }) => {
      expect(read.headers.get("content-disposition")).toBe(
        'attachment; filename="Orders-slow-payments-down-2026-10-02T0901Z.json"',
      )
      const decoded = Schema.decodeUnknownSync(TimelineExport)(read.json())
      expect(decoded.incident).toEqual({
        id: "i1",
        openedBy: "gil",
        openedAt: incident.openedAt,
        closedBy: "ada",
        closedAt: "2026-10-02T09:30:00Z",
        ended: "the pool was resized",
      })
      expect(decoded.firings.map((each) => [each.name, each.firing, each.notes.length])).toEqual([
        ["OrdersSlow", true, 2],
        ["PaymentsDown", false, 1],
      ])
      expect(decoded.events.map((each) => each.alert)).toEqual([
        "OrdersSlow",
        "PaymentsDown",
        "OrdersSlow",
        "OrdersSlow",
        "PaymentsDown",
      ])
      expect(missing.status).toBe(404)
    }))
})

describe("a viewer's export", () => {
  // Only an AI's answer drawn from logs is kept from viewers where logs are for operators (withheld.test.ts).
  test("with no AI answer in it is an operator's, as Markdown and as JSON, for a firing and an incident", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const paths = [
          "/api/firings/a1/timeline?env=staging",
          "/api/firings/a1/timeline?env=staging&format=json",
          "/api/incidents/i1/timeline",
          "/api/incidents/i1/timeline?format=json",
        ]
        const as = (configured: Settings) =>
          Effect.flatMap(seeded(configured), (server) =>
            Effect.forEach(paths, (path) => Effect.map(get(server, path), (read) => [read.status, read.text])),
          )
        return { viewer: yield* as(viewer), operator: yield* as(operator) }
      }),
    ).then(({ viewer, operator }) => {
      expect(viewer.map(([status]) => status)).toEqual([200, 200, 200, 200])
      expect(viewer).toEqual(operator)
    }))
})

describe("an export whose events cannot be read", () => {
  test("says why, for a firing and an incident", () => {
    const down = Layer.effect(Notes)(
      Effect.map(Notes, (notes) => ({
        ...notes,
        events: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
      })),
    ).pipe(Layer.provide(memoryNotes))
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(operator, kept, () => undefined, down)
        const firing = yield* get(server, "/api/firings/a1/timeline?env=staging")
        const incident = yield* get(server, "/api/incidents/i1/timeline")
        return [firing, incident].map((read) => [read.status, read.json()])
      }),
    ).then((reads) =>
      expect(reads).toEqual([
        [503, { message: "the notes database: down" }],
        [503, { message: "the notes database: down" }],
      ]),
    )
  })
})
