import { describe, expect, test } from "bun:test"
import { Effect, Fiber } from "effect"
import { TestClock } from "effect/testing"
import { AskLimits, liveAskLimits } from "./ask-limits"

const outcome = <E extends { message: string }>(effect: Effect.Effect<void, E>) =>
  Effect.map(Effect.result(effect), (result) => (result._tag === "Success" ? "ok" : result.failure.message))

describe("Ask AI's limits", () => {
  test("give an alert one answer a minute, and give its turn back when the ask failed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const limits = yield* AskLimits
        const seen = [
          yield* outcome(limits.take("a1")),
          yield* outcome(limits.take("a1")),
          yield* outcome(limits.take("a2")),
        ]
        yield* limits.giveBack("a2")
        seen.push(yield* outcome(limits.take("a2")))
        yield* TestClock.adjust("61 seconds")
        seen.push(yield* outcome(limits.take("a1")))
        return seen
      }).pipe(Effect.provide(liveAskLimits()), Effect.provide(TestClock.layer())),
    ).then((seen) =>
      expect(seen).toEqual(["ok", "this alert was asked about less than a minute ago", "ok", "ok", "ok"]),
    ))

  test("share an alert's answer within its minute, waiting for it, and nothing once the turn failed or passed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const limits = yield* AskLimits
        const answer = { likelyCause: "a deploy", evidence: [], nextSteps: [], confidence: "low" as const }
        const kept = {
          ...answer,
          model: "m",
          read: [],
          called: [],
          usage: { input: 0, cached: 0, output: 0 },
          readLogs: false,
        }
        yield* limits.take("a1")
        const waiting = yield* Effect.forkChild(limits.shared("a1"))
        yield* limits.keep("a1", kept)
        const waited = yield* Fiber.join(waiting)
        const later = yield* limits.shared("a1")
        yield* limits.take("a2")
        const failing = yield* Effect.forkChild(limits.shared("a2"))
        yield* limits.giveBack("a2")
        const failed = yield* Fiber.join(failing)
        yield* TestClock.adjust("61 seconds")
        return [waited, later, failed, yield* limits.shared("a1")]
      }).pipe(Effect.provide(liveAskLimits()), Effect.provide(TestClock.layer())),
    ).then(([waited, later, failed, passed]) => {
      expect(waited).toMatchObject({ likelyCause: "a deploy" })
      expect(later).toEqual(waited)
      expect([failed, passed]).toEqual([undefined, undefined])
    }))

  test("stop every alert once the day's tokens are spent, until the next day", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const limits = yield* AskLimits
        yield* limits.take("a1")
        yield* limits.spend(1200)
        const spent = yield* outcome(limits.take("a2"))
        yield* TestClock.adjust("1 day")
        return [spent, yield* outcome(limits.take("a2"))]
      }).pipe(Effect.provide(liveAskLimits(1000)), Effect.provide(TestClock.layer())),
    ).then((seen) => expect(seen).toEqual(["Ask AI has used today's 1,000 tokens", "ok"])))
})
