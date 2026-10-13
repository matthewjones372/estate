import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { environment, estate } from "./fixture"
import { loadHistory, recordFirings } from "./history"
import { memoryNotes, Notes } from "./notes"
import { stubRemote } from "./remote"
import { Estate, estateLayer, type SourcedAlert, updateEstate } from "./state"
import { alertsView } from "./views/alerts"

// Alertmanager writes a start to the second; Postgres reads it back with its milliseconds.
const asTheManagerSaysIt = "1970-01-02T10:00:00Z"
const asTheStoreReadsIt = "1970-01-02T10:00:00.000Z"

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: asTheManagerSaysIt,
  labels: { alertname: "OrdersSlow" },
}

describe("a firing kept before a restart, its start read back written another way", () => {
  test("is the same firing: it neither fires again nor resolves, and is not its own history", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        const key = { environment: "staging", alert: "a1" }
        yield* notes.keepFiring({ ...key, name: "OrdersSlow", severity: "warning", startsAt: asTheStoreReadsIt })
        yield* notes.keepThread({ ...key, startsAt: asTheStoreReadsIt, channel: "C1", ts: "1.2", url: "https://t" })
        yield* TestClock.setTime(Date.parse("1970-01-02T11:00:00Z"))
        yield* loadHistory(90)
        const recording = yield* Effect.forkChild(recordFirings())
        yield* TestClock.adjust("1 second")
        const live = environment({ alerts: { state: "ok", value: [slow] } })
        yield* updateEstate((state) => ({ ...state, environments: { staging: live } }))
        yield* TestClock.adjust("1 second")
        yield* Fiber.interrupt(recording)
        const state = yield* SubscriptionRef.get(yield* Estate)
        return {
          events: yield* notes.events({ ...key, startsAt: asTheManagerSaysIt }),
          stored: yield* notes.firings("1970-01-01T00:00:00Z"),
          card: alertsView(state, "staging", false).alerts[0],
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            memoryNotes,
            estateLayer(estate({ environments: { staging: environment() } })),
            TestClock.layer(),
            stubRemote(() => undefined),
          ),
        ),
      ),
    ).then(({ events, stored, card }) => {
      expect(events).toEqual([])
      expect(stored.map((each) => each.endsAt)).toEqual([undefined])
      expect(card?.history).toBeUndefined()
      expect(card?.thread).toEqual({ url: "https://t" })
    }))
})
