import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer, SubscriptionRef } from "effect"
import type { Incident } from "../../shared/incidents"
import { longestNote } from "../../shared/note"
import { ask, environment, estate, type Server, serverFor, settings } from "../fixture"
import { memoryNotes, Notes } from "../notes"
import { SourceFailure } from "../sources/run"
import { Estate, type SourcedAlert } from "../state"
import { alertsView } from "../views/alerts"

const startsAt = "2026-01-12T16:47:58Z"
const firing = (id: string, name: string): SourcedAlert => ({
  id,
  name,
  state: "firing",
  severity: "warning",
  startsAt,
  labels: { alertname: name },
})
const linked = (alert: string, name: string) => ({
  environment: "staging",
  alert,
  name,
  startsAt,
  linkedBy: "gil",
  linkedAt: "2026-01-12T16:50:30Z",
})
const restarted = { id: "n1", at: "2026-01-12T16:52:04Z", by: "gil", text: "registry container restarted" }
const slow: Incident = {
  id: "i1",
  title: "Chip registry slow",
  openedBy: "gil",
  openedAt: "2026-01-12T16:50:30Z",
  firings: [linked("a1", "ChipRegistryUnreachable"), linked("a2", "AdoptionsNotRecorded")],
  notes: [restarted],
}
const closed: Incident = { ...slow, id: "i2", title: "Done", closedBy: "gil", closedAt: "2026-01-12T17:03:30Z" }
const firings = estate({
  environments: {
    staging: environment({
      alerts: { state: "ok", value: [firing("a1", "ChipRegistryUnreachable"), firing("a2", "AdoptionsNotRecorded")] },
    }),
  },
  incidents: [slow, closed],
})
const operator = settings({ anonymous: { name: "gil", role: "operator" } })
const viewer = settings({ anonymous: { name: "vi", role: "viewer" } })

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const note = (id: string, text: unknown) => sending("POST", `/api/incidents/${id}/notes`, { text })
const removal = (id: string, noteId: string) => sending("DELETE", `/api/incidents/${id}/notes/${noteId}`)

const eventsOf = (server: Server, alert: string) =>
  Context.get(server.context, Notes)
    .events({ environment: "staging", alert, startsAt })
    .pipe(Effect.map((events) => events.map((each) => [each.by, each.kind, each.text])))

const shown = (server: Server) =>
  Effect.map(SubscriptionRef.get(Context.get(server.context, Estate)), (state) => ({
    incident: (state.incidents ?? []).find((each) => each.id === "i1"),
    cards: alertsView(state, "staging", false).alerts.map((alert) => alert.notes),
  }))

const merged = (server: Server) =>
  Effect.map(ask(server, sending("GET", "/api/incidents/i1")), (read) =>
    (read.json() as { events: ReadonlyArray<{ kind: string; text: string }> }).events.map((each) => [
      each.kind,
      each.text,
    ]),
  )

describe("an incident's notes", () => {
  test("are kept on its record and its store, shown on each firing's card, and an event on each firing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(operator, firings)
        const own = yield* ask(
          server,
          sending("POST", "/api/notes", { environment: "staging", alert: "a1", text: "x" }),
        )
        // A moment between the two, so the incident's note is the newer.
        yield* Effect.sleep("2 millis")
        const added = yield* ask(server, note("i1", " adoptions recovering \n slowly "))
        const kept = yield* Context.get(server.context, Notes).incidents("2026-01-01T00:00:00Z")
        return {
          own: own.json() as { id: string; at: string },
          added: [added.status, added.json()],
          kept: kept.find((each) => each.id === "i1"),
          ...(yield* shown(server)),
          a1: yield* eventsOf(server, "a1"),
          a2: yield* eventsOf(server, "a2"),
          merged: yield* merged(server),
        }
      }),
    ).then(({ own, added, kept, incident, cards, a1, a2, merged }) => {
      const written = {
        id: expect.any(String),
        at: expect.any(String),
        by: "gil",
        text: "adoptions recovering \n slowly",
      }
      expect(added).toEqual([201, { ...slow, notes: [restarted, written] }])
      expect(kept).toEqual(incident)
      expect(incident?.notes).toEqual([restarted, written])
      const on = { incident: { id: "i1", title: "Chip registry slow" } }
      const [first, second] = cards
      expect(first).toEqual([
        { ...written, ...on },
        { id: own.id, at: own.at, by: "gil", text: "x" },
        { ...restarted, ...on },
      ])
      expect(second).toEqual([
        { ...written, ...on },
        { ...restarted, ...on },
      ])
      expect(a1).toEqual([
        ["gil", "noted", "x"],
        ["gil", "incident-noted", "adoptions recovering \n slowly"],
      ])
      expect(a2).toEqual([["gil", "incident-noted", "adoptions recovering \n slowly"]])
      expect(merged.filter(([kind]) => kind === "incident-noted")).toEqual([
        ["incident-noted", "adoptions recovering \n slowly"],
      ])
    }))

  test("removing one keeps the record without it, and each firing's events say what it said", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(operator, firings)
        const removed = yield* ask(server, removal("i1", "n1"))
        return {
          removed: [removed.status, removed.json()],
          ...(yield* shown(server)),
          a1: yield* eventsOf(server, "a1"),
          a2: yield* eventsOf(server, "a2"),
          merged: yield* merged(server),
        }
      }),
    ).then(({ removed, incident, cards, a1, a2, merged }) => {
      expect(removed).toEqual([200, { ...slow, notes: [] }])
      expect(incident?.notes).toEqual([])
      expect(cards).toEqual([[], []])
      const said = ["gil", "incident-note-removed", "a note by gil: registry container restarted"]
      expect(a1).toEqual([said])
      expect(a2).toEqual([said])
      expect(merged).toEqual([["incident-note-removed", "a note by gil: registry container restarted"]])
    }))

  test("are written by anyone who may write, and removed by their author or an operator", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(viewer, firings)
        const added = yield* ask(server, note("i1", "on it"))
        const mine = (added.json() as Incident).notes?.find((each) => each.by === "vi")?.id ?? ""
        const theirs = yield* ask(server, removal("i1", "n1"))
        const own = yield* ask(server, removal("i1", mine))
        return { statuses: [added.status, theirs.status, own.status], left: (yield* shown(server)).incident?.notes }
      }),
    ).then(({ statuses, left }) => {
      expect(statuses).toEqual([201, 403, 200])
      expect(left).toEqual([restarted])
    }))

  test("refuse what is malformed, too long, unknown or on a closed incident, and every write where Estate is read-only", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(operator, firings)
        const asked = [
          sending("POST", "/api/incidents/i1/notes", { words: "x" }),
          note("i1", "  "),
          note("i1", "x".repeat(longestNote + 1)),
          note("nope", "x"),
          removal("nope", "n1"),
          removal("i1", "nope"),
          note("i2", "x"),
          removal("i2", "n1"),
        ]
        const statuses = yield* Effect.forEach(asked, (request) => Effect.map(ask(server, request), (r) => r.status))
        const readOnly = yield* serverFor({ ...operator, readOnly: true }, firings)
        const refused = yield* Effect.forEach([note("i1", "x"), removal("i1", "n1")], (request) =>
          Effect.map(ask(readOnly, request), (r) => r.status),
        )
        return { statuses, refused, events: yield* eventsOf(server, "a1") }
      }),
    ).then(({ statuses, refused, events }) => {
      expect(statuses).toEqual([400, 400, 400, 404, 404, 404, 400, 400])
      expect(refused).toEqual([403, 403])
      expect(events).toEqual([])
    }))

  test("say so when the store cannot keep the incident", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failing = Layer.effect(Notes)(
          Effect.map(Effect.provide(Notes, memoryNotes), (notes) => ({
            ...notes,
            keepIncident: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
          })),
        )
        const server = yield* serverFor(operator, firings, undefined, failing)
        const answers = yield* Effect.forEach([note("i1", "x"), removal("i1", "n1")], (request) =>
          Effect.map(ask(server, request), (r) => [r.status, r.json()]),
        )
        return { answers, ...(yield* shown(server)) }
      }),
    ).then(({ answers, incident }) => {
      expect(answers).toEqual([
        [503, { message: "the notes database: down" }],
        [503, { message: "the notes database: down" }],
      ])
      expect(incident).toEqual(slow)
    }))
})
