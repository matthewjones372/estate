import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { fakeDynamo, usingNotes } from "./dynamo-fake"
import { memoryNotes, Notes, type Notes as NotesService, postgresNotes, type Query, type StoredEvent } from "./notes"
import { stubRemote } from "./remote"

const firing = { environment: "production", alert: "a1", startsAt: "2026-10-12T16:47:58.000Z" }
const event = (id: string, at: string, more: Partial<StoredEvent> = {}): StoredEvent => ({
  ...firing,
  id,
  at,
  by: "matt",
  kind: "noted",
  text: `note ${id}`,
  ...more,
})

// Appended out of order, beside another firing of the same alert and one of an alert whose id starts the same.
const appendAndRead = (notes: NotesService) =>
  Effect.gen(function* () {
    yield* notes.addEvent(event("e2", "2026-10-12T16:52:04.000Z", { kind: "silenced", link: "https://silence/1" }))
    yield* notes.addEvent(event("e1", "2026-10-12T16:49:10.000Z", { by: "Estate", kind: "fired" }))
    yield* notes.addEvent(event("old", "2026-09-01T10:00:00.000Z", { startsAt: "2026-09-01T10:00:00.000Z" }))
    yield* notes.addEvent(event("other", "2026-10-12T16:50:00.000Z", { alert: "a10" }))
    const read = yield* notes.events(firing)
    const old = { ...firing, startsAt: "2026-09-01T10:00:00.000Z" }
    const before = yield* notes.events(old)
    yield* notes.removeFiringsBefore("2026-09-15T00:00:00.000Z")
    return { read, before, after: yield* notes.events(old), kept: yield* notes.events(firing) }
  })

const expectations = ({ read, before, after, kept }: Effect.Success<ReturnType<typeof appendAndRead>>) => {
  expect(read.map((each) => [each.id, each.by, each.kind])).toEqual([
    ["e1", "Estate", "fired"],
    ["e2", "matt", "silenced"],
  ])
  expect(read[1]).toEqual(event("e2", "2026-10-12T16:52:04.000Z", { kind: "silenced", link: "https://silence/1" }))
  expect(before.map((each) => each.id)).toEqual(["old"])
  expect(after).toEqual([])
  expect(kept.map((each) => each.id)).toEqual(["e1", "e2"])
}

/** A database that keeps events as Postgres would, enough for the statements the events use. */
const eventsDatabase = (): Query => {
  let rows: Array<Record<string, unknown>> = []
  return (statement, parameters) => {
    if (statement.startsWith("insert into estate_events")) {
      const [id, environment, alert, startsAt, at, by, kind, text, link] = parameters
      rows.push({
        id,
        environment,
        alert,
        starts_at: new Date(String(startsAt)),
        at: new Date(String(at)),
        by,
        kind,
        text,
        link,
      })
    }
    if (statement.startsWith("delete from estate_events"))
      rows = rows.filter((row) => (row["starts_at"] as Date).toISOString() >= String(parameters[0]))
    if (statement.startsWith("select") && statement.includes("from estate_events"))
      return Effect.succeed(
        rows
          .filter(
            (row) =>
              row["environment"] === parameters[0] &&
              row["alert"] === parameters[1] &&
              (row["starts_at"] as Date).toISOString() === new Date(String(parameters[2])).toISOString(),
          )
          .toSorted((a, b) => (a["at"] as Date).getTime() - (b["at"] as Date).getTime()),
      )
    return Effect.succeed([])
  }
}

describe("a firing's events", () => {
  test("are kept in memory in order, by firing, and swept with it", () =>
    Effect.runPromise(Effect.flatMap(Notes, appendAndRead).pipe(Effect.provide(memoryNotes))).then(expectations))

  test("are kept in Postgres in order, by firing, and swept with it", () =>
    Effect.runPromise(Effect.flatMap(Notes, appendAndRead).pipe(Effect.provide(postgresNotes(eventsDatabase())))).then(
      expectations,
    ))

  test("are kept in DynamoDB beside the notes, in order, by firing, and swept with it", () =>
    Effect.runPromise(usingNotes(appendAndRead, stubRemote(fakeDynamo([])))).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) expectations(result.success)
    }))
})
