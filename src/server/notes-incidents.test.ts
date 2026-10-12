import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import type { Incident } from "../shared/incidents"
import { fakeDynamo, note, usingNotes } from "./dynamo-fake"
import { memoryNotes, Notes, type Notes as NotesService, postgresNotes, type Query } from "./notes"
import { stubRemote } from "./remote"

const linked = (alert: string, linkedAt: string) => ({
  environment: "production",
  alert,
  startsAt: "2026-10-12T16:47:58.000Z",
  linkedBy: "matt",
  linkedAt,
})
const opened: Incident = {
  id: "i1",
  title: "Chip registry slow",
  openedBy: "matt",
  openedAt: "2026-10-12T16:50:30.000Z",
  firings: [linked("a1", "2026-10-12T16:50:30.000Z")],
}
const closed: Incident = {
  ...opened,
  closedBy: "gil",
  closedAt: "2026-10-12T17:03:30.000Z",
  ended: "registry restarted",
  link: "https://incidents.example/42",
  firings: [...opened.firings, linked("a2", "2026-10-12T16:51:40.000Z")],
  notes: [{ id: "n1", at: "2026-10-12T16:52:04.000Z", by: "gil", text: "registry container restarted" }],
}
const old: Incident = {
  id: "i0",
  title: "Last month",
  openedBy: "ada",
  openedAt: "2026-09-01T10:00:00.000Z",
  firings: [],
}

// Kept, then kept again as it changes, beside one opened before the sweep's cutoff.
const keepAndRead = (notes: NotesService) =>
  Effect.gen(function* () {
    yield* notes.keepIncident(opened)
    yield* notes.keepIncident(old)
    yield* notes.keepIncident(closed)
    const all = yield* notes.incidents("2026-01-01T00:00:00.000Z")
    const recent = yield* notes.incidents("2026-10-01T00:00:00.000Z")
    yield* notes.removeFiringsBefore("2026-09-15T00:00:00.000Z")
    return { all, recent, swept: yield* notes.incidents("2026-01-01T00:00:00.000Z") }
  })

const expectations = ({ all, recent, swept }: Effect.Success<ReturnType<typeof keepAndRead>>) => {
  expect(all).toEqual([closed, old])
  expect(recent).toEqual([closed])
  expect(swept).toEqual([closed])
}

/** A database that keeps incidents as Postgres would, enough for the statements the incidents use. */
const incidentsDatabase = (): Query => {
  const rows = new Map<string, Record<string, unknown>>()
  return (statement, parameters) => {
    if (statement.startsWith("insert into estate_incidents")) {
      const [id, openedAt, record] = parameters
      rows.set(String(id), { id, opened_at: new Date(String(openedAt)), record })
    }
    const at = (row: Record<string, unknown>) => (row["opened_at"] as Date).toISOString()
    if (statement.startsWith("delete from estate_incidents"))
      for (const [id, row] of rows) if (at(row) < String(parameters[0])) rows.delete(id)
    if (statement.startsWith("select") && statement.includes("from estate_incidents"))
      return Effect.succeed(
        [...rows.values()]
          .filter((row) => at(row) >= String(parameters[0]))
          .toSorted((a, b) => at(b).localeCompare(at(a))),
      )
    return Effect.succeed([])
  }
}

describe("incidents", () => {
  test("are kept whole in memory, read newest first, and swept by when they opened", () =>
    Effect.runPromise(Effect.flatMap(Notes, keepAndRead).pipe(Effect.provide(memoryNotes))).then(expectations))

  test("are kept whole in Postgres, read newest first, and swept by when they opened", () =>
    Effect.runPromise(Effect.flatMap(Notes, keepAndRead).pipe(Effect.provide(postgresNotes(incidentsDatabase())))).then(
      expectations,
    ))

  test("are kept whole in DynamoDB, read newest first, and swept by when they opened", () =>
    Effect.runPromise(usingNotes(keepAndRead, stubRemote(fakeDynamo([])))).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) expectations(result.success)
    }))

  test("in DynamoDB are no note or firing, and removing notes leaves them", () =>
    Effect.runPromise(
      usingNotes(
        (notes) =>
          Effect.gen(function* () {
            yield* notes.keepIncident(opened)
            yield* notes.add(note("n1", "2026-10-12T16:52:04.000Z"))
            const read = { notes: yield* notes.all, firings: yield* notes.firings("2026-01-01T00:00:00.000Z") }
            yield* notes.remove("i1")
            yield* notes.removeBefore("2026-12-01T00:00:00.000Z")
            return { ...read, incidents: yield* notes.incidents("2026-01-01T00:00:00.000Z") }
          }),
        stubRemote(fakeDynamo([])),
      ),
    ).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result))
        expect(result.success).toEqual({
          notes: [note("n1", "2026-10-12T16:52:04.000Z")],
          firings: [],
          incidents: [opened],
        })
    }))
})
