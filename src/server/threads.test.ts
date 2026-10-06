import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import { estate } from "./fixture"
import { memoryNotes, Notes, postgresNotes } from "./notes"
import { type Call, reply, stubRemote } from "./remote"
import { estateLayer } from "./state"
import { lasting, replyInThread } from "./threads"

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

describe("a told firing's thread", () => {
  test("says how long in words a thread reads easily", () =>
    expect([lasting(15), lasting(60), lasting(150), lasting(60 * 24), lasting(60 * 72)]).toEqual([
      "15 min",
      "1 hour",
      "3 hours",
      "1 day",
      "3 days",
    ]))

  test("is told when its firing ends, and a failed reply is logged, not thrown", () => {
    const calls: Call[] = []
    const thread = {
      environment: "production",
      alert: "a1",
      startsAt: "2026-10-03T11:00:00.000Z",
      channel: "C0ORDERS",
      ts: "1.2",
      url: "https://slack/p1",
    }
    const slack = { token: Redacted.make("xoxb"), url: "http://slack.test/api" }
    return Effect.runPromise(
      Effect.gen(function* () {
        yield* replyInThread(slack, { ...thread, startsAt: "2026-10-03T11:00:00.000Z" }, "✅ Resolved after 22 min")
        yield* replyInThread(slack, { environment: "production", alert: "a1" }, "not the told firing")
        yield* replyInThread(undefined, thread, "no Slack")
      }).pipe(
        Effect.provide(
          Layer.merge(
            estateLayer(estate({ threads: [thread] })),
            stubRemote((call) => {
              calls.push(call)
              return reply({ ok: false, error: "channel_not_found" })
            }),
          ),
        ),
      ),
    ).then(() => {
      expect(calls.map((call) => JSON.parse(call.body ?? "{}").text)).toEqual(["✅ Resolved after 22 min"])
    })
  })
})
