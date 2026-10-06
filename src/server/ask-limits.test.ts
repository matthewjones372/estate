import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
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
