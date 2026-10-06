import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { ask, estate, serverFor, settings } from "./fixture"
import { loadNotes, sweepNotes } from "./http/notes"
import { memoryNotes, Notes, postgresNotes, type Query, type StoredNote } from "./notes"
import { SourceFailure } from "./sources/run"
import { Estate, estateLayer, updateEstate } from "./state"

const note: StoredNote = {
  id: "n1",
  environment: "staging",
  alert: "a1",
  at: "2026-10-03T11:50:00.000Z",
  by: "gil",
  text: "On it.",
}

/** A database that keeps what it is told and answers selects with it. */
const database =
  (statements: Array<readonly [string, ReadonlyArray<unknown>]>, rows: Array<Record<string, unknown>> = []): Query =>
  (statement, parameters) => {
    statements.push([statement.replace(/\s+/g, " ").trim(), parameters])
    if (statement.startsWith("insert"))
      rows.push({
        id: parameters[0],
        environment: parameters[1],
        alert: parameters[2],
        at: new Date(String(parameters[3])),
        by: parameters[4],
        text: parameters[5],
      })
    return Effect.succeed(statement.startsWith("select") ? rows : [])
  }

describe("notes in Postgres", () => {
  test("make their table, are kept with who and when, and read back", () => {
    const statements: Array<readonly [string, ReadonlyArray<unknown>]> = []
    const program = Effect.gen(function* () {
      const notes = yield* Notes
      yield* notes.add(note)
      return yield* notes.all
    })
    return Effect.runPromise(program.pipe(Effect.provide(postgresNotes(database(statements))))).then((all) => {
      expect(all).toEqual([note])
      expect(statements[0]?.[0]).toStartWith("create table if not exists estate_notes")
      expect(statements[4]).toEqual([
        "insert into estate_notes (id, environment, alert, at, by, text) values ($1, $2, $3, $4, $5, $6)",
        ["n1", "staging", "a1", "2026-10-03T11:50:00.000Z", "gil", "On it."],
      ])
    })
  })

  test("a database that does not answer stops Estate, saying so", () =>
    Effect.runPromise(
      Effect.result(
        Effect.provide(
          Notes,
          postgresNotes(() => Effect.fail(new SourceFailure({ message: "the database: refused" }))),
        ),
      ),
    ).then((result) => {
      expect(Result.isFailure(result) && result.failure).toMatchObject({
        _tag: "NotesError",
        message: "the database: refused",
      })
    }))
})

describe("adding a note", () => {
  const anonymous = settings({ anonymous: { name: "gil", role: "viewer" } })
  const post = (body: unknown) =>
    new Request("http://estate/api/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })

  test("keeps it under the person's name, and puts it on the stream", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(anonymous, estate())
        const answered = yield* ask(server, post({ environment: "staging", alert: "a1", text: "  On it.  " }))
        expect(answered.status).toBe(201)
        expect(answered.json()).toMatchObject({ environment: "staging", alert: "a1", by: "gil", text: "On it." })
        const kept = yield* Effect.provide(Notes, server.context)
        expect((yield* kept.all).map((each) => each.text)).toEqual(["On it."])
      }),
    ))

  test("refuses a note that is empty, too long, malformed, or for no environment", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(anonymous)
        expect((yield* ask(server, post({ environment: "staging", alert: "a1", text: "  " }))).status).toBe(400)
        expect((yield* ask(server, post({ environment: "staging", alert: "a1", text: "x".repeat(2001) }))).status).toBe(
          400,
        )
        expect((yield* ask(server, post({ environment: "staging" }))).json()).toEqual({
          message: "a note is an environment, an alert and its text",
        })
        expect((yield* ask(server, post({ environment: "qa", alert: "a1", text: "hi" }))).status).toBe(404)
      }),
    ))

  test("says so when the database does not keep it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(
          anonymous,
          estate(),
          undefined,
          Layer.succeed(Notes)({
            all: Effect.succeed([]),
            add: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
            remove: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
            removeBefore: () => Effect.void,
            impacts: Effect.succeed([]),
            setImpact: () => Effect.void,
            firings: () => Effect.succeed([]),
            keepFiring: () => Effect.void,
            removeFiringsBefore: () => Effect.void,
            threads: () => Effect.succeed([]),
            keepThread: () => Effect.void,
          }),
        )
        const answered = yield* ask(server, post({ environment: "staging", alert: "a1", text: "hi" }))
        expect(answered.status).toBe(503)
        expect(answered.json()).toEqual({ message: "the notes database: down" })
      }),
    ))

  test("needs someone signed in", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const oidc = settings({
          oidc: {
            issuer: "https://id.example",
            clientId: "e",
            clientSecret: Redacted.make("s"),
            publicUrl: "https://e",
          },
        })
        expect(
          (yield* ask(yield* serverFor(oidc), post({ environment: "staging", alert: "a1", text: "hi" }))).status,
        ).toBe(401)
      }),
    ))

  test("in memory, newest first", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* notes.add(note)
        yield* notes.add({ ...note, id: "n2" })
        return (yield* notes.all).map((each) => each.id)
      }).pipe(Effect.provide(memoryNotes)),
    ).then((ids) => expect(ids).toEqual(["n2", "n1"])))
})

describe("the notes already kept", () => {
  test("are in the estate as it starts", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* notes.add(note)
        yield* loadNotes
        return (yield* SubscriptionRef.get(yield* Estate)).notes
      }).pipe(Effect.provide(Layer.merge(memoryNotes, estateLayer(estate())))),
    ).then((notes) => expect(notes).toEqual([note])))
})

describe("taking a note back", () => {
  const as = (name: string, role: "viewer" | "operator") => settings({ anonymous: { name, role } })
  const remove = (id: string) => new Request(`http://estate/api/notes/${id}`, { method: "DELETE" })
  const withNote = estate({ notes: [note] })

  test("is for whoever wrote it, or an operator", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const other = yield* serverFor(as("eve", "viewer"), withNote)
        expect((yield* ask(other, remove("n1"))).status).toBe(403)
        expect((yield* ask(other, remove("nope"))).status).toBe(404)
        for (const person of [as("gil", "viewer"), as("ada", "operator")]) {
          const server = yield* serverFor(person, withNote)
          expect((yield* ask(server, remove("n1"))).status).toBe(200)
          expect((yield* SubscriptionRef.get(yield* Effect.provide(Estate, server.context))).notes).toEqual([])
        }
      }),
    ))

  test("says so when the database does not", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(
          as("gil", "viewer"),
          withNote,
          undefined,
          Layer.succeed(Notes)({
            all: Effect.succeed([]),
            add: () => Effect.void,
            remove: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
            removeBefore: () => Effect.void,
            impacts: Effect.succeed([]),
            setImpact: () => Effect.void,
            firings: () => Effect.succeed([]),
            keepFiring: () => Effect.void,
            removeFiringsBefore: () => Effect.void,
            threads: () => Effect.succeed([]),
            keepThread: () => Effect.void,
          }),
        )
        const answered = yield* ask(server, remove("n1"))
        expect([answered.status, answered.json()]).toEqual([503, { message: "the notes database: down" }])
      }),
    ))
})

describe("old notes", () => {
  test("are removed after the days they are kept, from the store and the page", () => {
    const old = { ...note, id: "old", at: "1970-01-01T00:00:00.000Z" }
    const recent = { ...note, id: "recent", at: "1970-01-31T00:00:00.000Z" }
    const program = Effect.gen(function* () {
      const notes = yield* Notes
      yield* notes.add(old)
      yield* notes.add(recent)
      yield* updateEstate((state) => ({ ...state, notes: [recent, old] }))
      yield* TestClock.setTime(Date.parse("1970-02-15T00:00:00Z"))
      yield* Effect.forkChild(sweepNotes(30))
      yield* TestClock.adjust("1 second")
      return {
        kept: (yield* notes.all).map((each) => each.id),
        shown: (yield* SubscriptionRef.get(yield* Estate)).notes.map((each) => each.id),
      }
    })
    return Effect.runPromise(
      program.pipe(Effect.provide(Layer.mergeAll(memoryNotes, estateLayer(estate()), TestClock.layer()))),
    ).then((result) => {
      expect(result).toEqual({ kept: ["recent"], shown: ["recent"] })
    })
  })

  test("are removed from Postgres by their time", () => {
    const statements: Array<readonly [string, ReadonlyArray<unknown>]> = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* notes.remove("n1")
        yield* notes.removeBefore("2026-09-03T00:00:00.000Z")
      }).pipe(Effect.provide(postgresNotes(database(statements)))),
    ).then(() => {
      expect(statements.slice(4)).toEqual([
        ["delete from estate_notes where id = $1", ["n1"]],
        ["delete from estate_notes where at < $1", ["2026-09-03T00:00:00.000Z"]],
      ])
    })
  })
})
