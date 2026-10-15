import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, Result, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import type { EvidenceSet } from "../shared/evidence"
import type { Incident } from "../shared/incidents"
import { seenLive } from "../shared/timeline"
import { fakeDynamo, usingNotes } from "./dynamo-fake"
import { environment, estate } from "./fixture"
import { loadHistory, sweepHistory } from "./history"
import { memoryNotes, Notes, type Notes as NotesService, postgresNotes, type Query, type StoredFiring } from "./notes"
import { stubRemote } from "./remote"
import { Estate, estateLayer } from "./state"

// The sweep runs on 1971-03-01: firings go after 90 days, incidents after 400.
const now = Date.parse("1971-03-01T12:00:00Z")
const firing = (alert: string, startsAt: string): StoredFiring => ({
  environment: "staging",
  alert,
  name: alert,
  startsAt,
  endsAt: startsAt,
})
const linked = (each: StoredFiring) => ({ ...each, linkedBy: "gil", linkedAt: each.startsAt })
const incident = (id: string, openedAt: string, firings: ReadonlyArray<StoredFiring>): Incident => ({
  id,
  title: id,
  openedBy: "gil",
  openedAt,
  firings: firings.map(linked),
})
const set: EvidenceSet = {
  id: "e",
  keptAt: "1970-01-01T00:00:00Z",
  keptBy: "Estate",
  window: { start: 0, end: 60, step: 60 },
  charts: [],
}

const lonely = firing("lonely", "1970-10-01T00:00:00.000Z")
const kept = firing("kept", "1970-10-01T00:00:00.000Z")
const ancient = firing("ancient", "1969-12-01T00:00:00.000Z")
const recent = incident("recent", "1970-10-01T00:00:00.000Z", [kept])
const old = incident("old", "1969-12-01T00:00:00.000Z", [ancient])

/** Two firings past the history's days, one in an incident; and an incident past its own days, with all it holds. */
const stored = (notes: NotesService) =>
  Effect.gen(function* () {
    for (const each of [lonely, kept, ancient]) {
      yield* notes.keepFiring(each)
      yield* notes.addEvent({
        ...each,
        ...seenLive({ id: `${each.alert}-fired`, at: each.startsAt, by: "Estate", kind: "fired", text: each.alert }),
      })
    }
    for (const each of [recent, old]) {
      yield* notes.keepIncident(each)
      yield* notes.addIncidentEvent({
        incident: each.id,
        ...seenLive({ id: `${each.id}-own`, at: each.openedAt, by: "gil", kind: "happened", text: "x" }),
      })
      yield* notes.keepEvidence(each.id, { ...set, id: `${each.id}-set` })
    }
  })

/** What is left of each, after a sweep of the store alone. */
const left = (notes: NotesService) =>
  Effect.gen(function* () {
    return {
      firings: (yield* notes.firings("1969-01-01T00:00:00Z")).map((each) => each.alert).sort(),
      events: (yield* Effect.forEach([lonely, kept, ancient], (each) => notes.events(each))).map((each) => each.length),
      incidents: (yield* notes.incidents("1969-01-01T00:00:00Z")).map((each) => each.id),
      own: (yield* Effect.forEach([recent, old], (each) => notes.incidentEvents(each.id))).map((each) => each.length),
      evidence: (yield* Effect.forEach([recent, old], (each) => notes.evidence(each.id))).map((each) => each.length),
    }
  })

const swept = { firings: ["kept"], events: [0, 1, 0], incidents: ["recent"], own: [1, 0], evidence: [1, 0] }

describe("what is kept, and for how long", () => {
  test("keeps a firing in an incident past alerts.historyDays, and removes an incident past incidents.keepDays with all of it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* stored(notes)
        yield* TestClock.setTime(now)
        yield* loadHistory(90, 400)
        const sweeping = yield* Effect.forkChild(sweepHistory(90, 400))
        yield* TestClock.adjust("1 second")
        yield* Fiber.interrupt(sweeping)
        const state = yield* SubscriptionRef.get(yield* Estate)
        return {
          store: yield* left(notes),
          shown: {
            firings: (state.firings ?? []).map((each) => each.alert),
            incidents: (state.incidents ?? []).map((each) => each.id),
          },
        }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            memoryNotes,
            estateLayer(estate({ environments: { staging: environment() } })),
            TestClock.layer(),
          ),
        ),
      ),
    ).then(({ store, shown }) => {
      expect(store).toEqual(swept)
      expect(shown).toEqual({ firings: ["kept"], incidents: ["recent"] })
    }))

  test("is the same in DynamoDB", () =>
    Effect.runPromise(
      usingNotes(
        (notes) =>
          Effect.gen(function* () {
            yield* stored(notes)
            yield* notes.removeIncidentsBefore("1970-01-25T12:00:00.000Z")
            yield* notes.removeFiringsBefore("1970-12-01T12:00:00.000Z", recent.firings)
            return yield* left(notes)
          }),
        stubRemote(fakeDynamo([])),
      ),
    ).then((result) => {
      expect(Result.isSuccess(result) ? result.success : result).toEqual(swept)
    }))

  test("spares the firings an incident holds in Postgres, by their keys, in one statement a table", () => {
    const statements: Array<readonly [string, ReadonlyArray<unknown>]> = []
    const query: Query = (statement, parameters) => {
      statements.push([statement, parameters])
      return Effect.succeed([])
    }
    return Effect.runPromise(
      Effect.flatMap(Notes, (notes) => notes.removeFiringsBefore("1970-12-01T12:00:00.000Z", recent.firings)).pipe(
        Effect.provide(postgresNotes(query)),
      ),
    ).then(() => {
      expect(
        statements.filter(([statement]) => statement.startsWith("delete")).map(([, parameters]) => parameters),
      ).toEqual([
        ["1970-12-01T12:00:00.000Z", ["staging"], ["kept"], [kept.startsAt]],
        ["1970-12-01T12:00:00.000Z", ["staging"], ["kept"], [kept.startsAt]],
      ])
    })
  })
})
