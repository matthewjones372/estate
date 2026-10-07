import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Layer, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { environment, estate } from "./fixture"
import { changed, firingNow, loadHistory, recordFirings, sweepHistory } from "./history"
import { memoryNotes, Notes, postgresNotes, type Query } from "./notes"
import { stubRemote } from "./remote"
import { Estate, type EstateState, estateLayer, type SourcedAlert, type StoredFiring, updateEstate } from "./state"
import { alertsView } from "./views/alerts"

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "1970-01-02T10:00:00.000Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}
const firing = (alerts: ReadonlyArray<SourcedAlert>, state: "ok" | "failing" | "waiting" = "ok") =>
  environment({ alerts: state === "waiting" ? { state } : { state, value: alerts } })
const withAlerts = (alerts: ReadonlyArray<SourcedAlert>, state: "ok" | "failing" | "waiting" = "ok") =>
  estate({ environments: { staging: firing(alerts, state) } })

const kept: StoredFiring = {
  environment: "staging",
  alert: "a1",
  name: "OrdersSlow",
  service: "orders",
  severity: "warning",
  startsAt: slow.startsAt,
}

describe("an alert's firings", () => {
  test("are kept as they begin, are silenced and end; an environment that has not answered ends none", () => {
    const begun = firingNow(withAlerts([slow]))
    expect(changed(new Map(), begun, "t")).toEqual([kept])
    const was = begun.firing
    expect(changed(was, begun, "t")).toEqual([])
    const silenced = firingNow(
      withAlerts([
        { ...slow, state: "silenced", silence: { id: "s1", by: "ada", reason: "vacuum", startsAt: "", endsAt: "" } },
      ]),
    )
    expect(changed(was, silenced, "t")).toEqual([{ ...kept, silence: { by: "ada", reason: "vacuum" } }])
    expect(changed(was, firingNow(withAlerts([], "failing")), "t")).toEqual([])
    expect(changed(was, firingNow(withAlerts([])), "1970-01-02T10:30:00.000Z")).toEqual([
      { ...kept, endsAt: "1970-01-02T10:30:00.000Z" },
    ])
    expect(firingNow(withAlerts([{ ...slow, state: "pending" }])).firing.size).toBe(0)
  })

  test("keep what the alert said as it fired: its severity, summary, runbook and store", () => {
    const said = firingNow(
      withAlerts([{ ...slow, severity: "critical", summary: "p99 over 2s", runbook: "https://wiki.example/orders" }]),
    )
    expect([...said.firing.values()]).toEqual([
      { ...kept, severity: "critical", summary: "p99 over 2s", runbook: "https://wiki.example/orders" },
    ])
  })

  test("are recorded in the store and the state while Estate runs, from what it already kept", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* notes.keepFiring({ ...kept, alert: "old", startsAt: "1970-01-01T09:00:00.000Z" })
        yield* TestClock.setTime(Date.parse("1970-01-02T11:00:00Z"))
        yield* loadHistory(90)
        const recording = yield* Effect.forkChild(recordFirings())
        yield* TestClock.adjust("1 second")
        yield* updateEstate((state) => ({ ...state, environments: { ...state.environments, staging: firing([slow]) } }))
        yield* TestClock.adjust("1 second")
        yield* updateEstate((state) => ({ ...state, environments: { ...state.environments, staging: firing([]) } }))
        yield* TestClock.adjust("1 second")
        yield* Fiber.interrupt(recording)
        const shown = (yield* SubscriptionRef.get(yield* Estate)).firings ?? []
        return { stored: yield* notes.firings("1970-01-01T00:00:00Z"), shown }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            memoryNotes,
            estateLayer(withAlerts([])),
            TestClock.layer(),
            stubRemote(() => undefined),
          ),
        ),
      ),
    ).then(({ stored, shown }) => {
      expect(stored.map((each) => [each.alert, each.endsAt])).toEqual([
        ["a1", "1970-01-02T11:00:02.000Z"],
        ["old", "1970-01-02T11:00:00.000Z"],
      ])
      expect(shown.map((each) => each.alert).sort()).toEqual(["a1", "old"])
    }))

  test("ended today are what resolved, after a restart; older than the days kept they are swept", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* notes.keepFiring({ ...kept, endsAt: "1970-03-31T09:00:00.000Z", startsAt: "1970-03-31T08:00:00.000Z" })
        yield* notes.keepFiring({ ...kept, startsAt: "1970-01-01T08:00:00.000Z", endsAt: "1970-01-01T09:00:00.000Z" })
        yield* TestClock.setTime(Date.parse("1970-03-31T12:00:00Z"))
        yield* loadHistory(30)
        const resolved = (yield* SubscriptionRef.get(yield* Estate)).environments["staging"]?.resolved
        const sweeping = yield* Effect.forkChild(sweepHistory(30))
        yield* TestClock.adjust("1 second")
        yield* Fiber.interrupt(sweeping)
        return { resolved, left: yield* notes.firings("1970-01-01T00:00:00Z") }
      }).pipe(Effect.provide(Layer.mergeAll(memoryNotes, estateLayer(withAlerts([])), TestClock.layer()))),
    ).then(({ resolved, left }) => {
      expect(resolved).toEqual([
        {
          alert: "a1",
          name: "OrdersSlow",
          labels: { service: "orders" },
          startsAt: "1970-03-31T08:00:00.000Z",
          endsAt: "1970-03-31T09:00:00.000Z",
        },
      ])
      expect(left.map((each) => each.startsAt)).toEqual(["1970-03-31T08:00:00.000Z"])
    }))

  test("are kept in Postgres, a firing's end and silence written over its start", () => {
    const statements: Array<readonly [string, ReadonlyArray<unknown>]> = []
    const rows = [
      {
        environment: "staging",
        alert: "a1",
        name: "OrdersSlow",
        service: null,
        starts_at: new Date(slow.startsAt),
        ends_at: null,
        silenced_by: "ada",
        silence_reason: "vacuum",
        severity: "critical",
        summary: "p99 over 2s",
        runbook: null,
        store: "orders-db",
      },
    ]
    const query: Query = (statement, parameters) => {
      statements.push([statement.replace(/\s+/g, " ").trim(), parameters])
      return Effect.succeed(statement.includes("from estate_firings") ? rows : [])
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const notes = yield* Notes
        yield* notes.keepFiring({ ...kept, endsAt: "1970-01-02T11:00:00.000Z" })
        yield* notes.removeFiringsBefore("1970-01-01T00:00:00.000Z")
        return yield* notes.firings("1970-01-01T00:00:00.000Z")
      }).pipe(Effect.provide(postgresNotes(query))),
    ).then((read) => {
      expect(read).toEqual([
        {
          environment: "staging",
          alert: "a1",
          name: "OrdersSlow",
          startsAt: slow.startsAt,
          silence: { by: "ada", reason: "vacuum" },
          severity: "critical",
          summary: "p99 over 2s",
          store: "orders-db",
        },
      ])
      expect(statements[3]?.[0]).toContain("add column if not exists summary text")
      expect(statements[5]?.[0]).toContain("on conflict (environment, alert, starts_at) do update")
      expect(statements[5]?.[1]).toEqual([
        "staging",
        "a1",
        "OrdersSlow",
        slow.startsAt,
        "1970-01-02T11:00:00.000Z",
        null,
        null,
        "orders",
        "warning",
        null,
        null,
        null,
      ])
      expect(statements[6]).toEqual(["delete from estate_firings where starts_at < $1", ["1970-01-01T00:00:00.000Z"]])
    })
  })

  test("are on the card of the alert firing again, newest first, each with the notes written while it fired", () => {
    const note = (id: string, at: string) => ({ id, environment: "staging", alert: "a1", at, by: "ada", text: id })
    const state: EstateState = {
      ...withAlerts([{ ...slow, startsAt: "1970-01-05T10:00:00.000Z" }]),
      firings: [
        {
          ...kept,
          startsAt: "1970-01-03T10:00:00.000Z",
          endsAt: "1970-01-03T10:20:00.000Z",
          silence: { by: "gil", reason: "deploy" },
        },
        { ...kept, startsAt: "1970-01-01T10:00:00.000Z", endsAt: "1970-01-01T10:05:00.000Z" },
        { ...kept, alert: "other", startsAt: "1970-01-02T10:00:00.000Z" },
      ],
      notes: [
        note("now", "1970-01-05T10:01:00.000Z"),
        note("second", "1970-01-03T10:10:00.000Z"),
        note("first", "1970-01-01T10:01:00.000Z"),
      ],
    }
    const [shown] = alertsView(state, "staging", false).alerts
    expect(shown?.notes.map((each) => each.id)).toEqual(["now"])
    expect(shown?.history).toEqual([
      {
        startsAt: "1970-01-03T10:00:00.000Z",
        endsAt: "1970-01-03T10:20:00.000Z",
        silence: { by: "gil", reason: "deploy" },
        notes: [{ id: "second", at: "1970-01-03T10:10:00.000Z", by: "ada", text: "second" }],
      },
      {
        startsAt: "1970-01-01T10:00:00.000Z",
        endsAt: "1970-01-01T10:05:00.000Z",
        notes: [{ id: "first", at: "1970-01-01T10:01:00.000Z", by: "ada", text: "first" }],
      },
    ])
    expect(alertsView(withAlerts([slow]), "staging", false).alerts[0]?.history).toBeUndefined()
  })
})
