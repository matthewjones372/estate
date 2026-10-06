import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { memoryNotes, Notes, postgresNotes } from "./notes"

describe("a firing's Slack thread", () => {
  const thread = {
    environment: "production",
    alert: "a1",
    startsAt: "2026-10-02T10:00:00.000Z",
    channel: "C0ORDERS",
    ts: "1759399200.000100",
    url: "https://example.slack.com/archives/C0ORDERS/p1",
  }

  test("is kept once a firing in memory, and read back from a time on", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* notes.keepThread(thread)
        yield* notes.keepThread({ ...thread, ts: "again" })
        yield* notes.keepThread({ ...thread, alert: "a0", startsAt: "2026-09-01T00:00:00.000Z" })
        return yield* notes.threads("2026-09-15T00:00:00.000Z")
      }).pipe(Effect.provide(memoryNotes)),
    ).then((threads) => expect(threads).toEqual([thread])))

  test("is kept in Postgres by its firing, its first post kept", () => {
    const statements: Array<readonly [string, ReadonlyArray<unknown>]> = []
    const rows = [{ ...thread, starts_at: new Date(thread.startsAt) }]
    return Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* notes.keepThread(thread)
        return yield* notes.threads("2026-09-15T00:00:00.000Z")
      }).pipe(
        Effect.provide(
          postgresNotes((statement, parameters) => {
            statements.push([statement, parameters])
            return Promise.resolve(statement.startsWith("select") ? rows : [])
          }),
        ),
      ),
    ).then((threads) => {
      expect(threads).toEqual([thread])
      expect(statements[3]?.[0]).toStartWith("create table if not exists estate_threads")
      expect(statements[4]?.[0]).toContain("on conflict (environment, alert, starts_at) do nothing")
    })
  })
})
