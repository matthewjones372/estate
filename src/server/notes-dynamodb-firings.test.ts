import { describe, expect, test } from "bun:test"
import { Effect, Result } from "effect"
import { fakeDynamo, note, usingNotes } from "./dynamo-fake"
import { type Call, stubRemote } from "./remote"

const withNotes = <A>(...asked: Parameters<typeof usingNotes<A>>) => Effect.runPromise(usingNotes(...asked))

const said = {
  severity: "critical",
  summary: "p99 over 2s",
  runbook: "https://wiki.example/orders",
  store: "orders-db",
}

describe("firings in DynamoDB", () => {
  test("are kept beside the notes, a firing's end and silence written over its start, and swept by their time", () => {
    const calls: Call[] = []
    const firing = {
      environment: "production",
      alert: "a1",
      name: "OrdersSlow",
      service: "orders",
      ...said,
      startsAt: "2026-10-02T10:00:00Z",
    }
    return withNotes(
      (notes) =>
        Effect.gen(function* () {
          yield* notes.add(note("n1", "2026-10-02T10:01:00Z"))
          yield* notes.keepFiring(firing)
          yield* notes.keepFiring({
            ...firing,
            endsAt: "2026-10-02T10:20:00Z",
            silence: { by: "gil", reason: "deploy" },
          })
          yield* notes.keepFiring({ ...firing, startsAt: "2026-09-01T10:00:00Z" })
          yield* notes.keepThread({ ...firing, channel: "C0ORDERS", ts: "1.2", url: "https://slack/p1" })
          const threads = yield* notes.threads("2026-09-15T00:00:00Z")
          const read = yield* notes.firings("2026-09-15T00:00:00Z")
          yield* notes.removeFiringsBefore("2026-09-15T00:00:00Z")
          return { read, threads, left: yield* notes.firings("2026-01-01T00:00:00Z"), notes: yield* notes.all }
        }),
      stubRemote(fakeDynamo(calls)),
    ).then((result) => {
      const done = Result.isSuccess(result) ? result.success : undefined
      expect(done?.read).toEqual([
        { ...firing, endsAt: "2026-10-02T10:20:00Z", silence: { by: "gil", reason: "deploy" } },
      ])
      expect(done?.left.map((each) => each.startsAt)).toEqual(["2026-10-02T10:00:00Z"])
      expect(done?.threads.map((each) => `${each.alert} ${each.channel} ${each.ts} ${each.url}`)).toEqual([
        "a1 C0ORDERS 1.2 https://slack/p1",
      ])
      expect(done?.notes.map((each) => each.id)).toEqual(["n1"])
    })
  })
})
