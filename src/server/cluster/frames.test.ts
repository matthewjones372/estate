import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Result, Stream, SubscriptionRef } from "effect"
import { catalog, environment, estate } from "../fixture"
import { followed, frameOf } from "./frames"
import { framesOf } from "./owner"
import { decodeEnvironment, decodeParts } from "./wire"

const before = estate({ environments: { production: environment(), staging: environment() } })

describe("the frames a follower is sent", () => {
  test("are the whole estate first, with the runner reading it", () => {
    expect(frameOf(undefined, before, "10.0.4.12:34431")).toEqual({
      _tag: "Whole",
      owner: "10.0.4.12:34431",
      estate: before,
    })
  })

  test("then only what changed, by environment and part", () => {
    const production = before.environments["production"] ?? environment()
    const now = {
      ...before,
      notes: [
        { id: "n1", environment: "production", alert: "a", at: "2026-10-06T00:00:00Z", by: "Ada", text: "on it" },
      ],
      environments: {
        ...before.environments,
        production: { ...production, alerts: { state: "ok" as const, value: [] } },
      },
    }
    const frame = frameOf(before, now, "a")
    expect(frame).toEqual({
      _tag: "Changed",
      environments: { production: { alerts: { keys: { state: { set: "ok" }, value: { set: [] } } } } },
      parts: { notes: { set: now.notes } },
    })
    expect(followed(before, frame)).toEqual(Result.succeed(now))
  })

  test("are whole again when the catalog or its environments change", () => {
    const fewer = { ...before, environments: { production: environment() } }
    expect(frameOf(before, fewer, "a")._tag).toBe("Whole")
    expect(frameOf(before, { ...before, catalog: { ...catalog } }, "a")._tag).toBe("Whole")
    expect(followed(before, frameOf(before, fewer, "a"))).toEqual(Result.succeed(fewer))
  })

  test("say nothing when nothing changed", () => {
    expect(frameOf(before, before, "a")).toEqual({ _tag: "Changed", environments: {}, parts: {} })
  })

  test("send a series that moved along as the points it gained, and the follower has it as the owner does", () => {
    const series = (points: ReadonlyArray<number>) => ({ now: points.at(-1) ?? null, points })
    const read = (points: ReadonlyArray<number>) =>
      environment({
        metrics: {
          state: "ok",
          value: { services: { orders: { requests: series(points) } }, vitals: [], edges: [], charts: {} },
        },
      })
    const hour = Array.from({ length: 60 }, (_, index) => 100 + index * 1.234567)
    const was = { ...before, environments: { ...before.environments, production: read(hour) } }
    const now = { ...was, environments: { ...was.environments, production: read([...hour.slice(1), 60.5]) } }
    const frame = frameOf(was, now, "a")
    expect(JSON.stringify(frame)).toContain('"points":{"shift":1,"tail":[60.5]}')
    expect(JSON.stringify(frame).length).toBeLessThan(JSON.stringify(hour).length / 3)
    expect(followed(was, frame)).toEqual(Result.succeed(now))
  })

  test("that do not apply to what the follower has are refused, so it follows again", () => {
    expect(Result.isFailure(followed(before, { _tag: "Changed", environments: { elsewhere: {} }, parts: {} }))).toBe(
      true,
    )
    expect(
      Result.isFailure(
        followed(before, { _tag: "Changed", environments: { production: { tools: { set: 1 } } }, parts: {} }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        followed(before, { _tag: "Changed", environments: { production: { alerts: { set: 1 } } }, parts: {} }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(followed(before, { _tag: "Changed", environments: {}, parts: { notes: { set: 1 } } })),
    ).toBe(true)
  })
})

describe("the owner's frames", () => {
  test("are the whole estate, then each change as it is made", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const estate = yield* SubscriptionRef.make(before)
        const frames = yield* Effect.forkChild(framesOf(estate, "a").pipe(Stream.take(2), Stream.runCollect))
        yield* Effect.sleep("10 millis")
        yield* SubscriptionRef.update(estate, (state) => ({ ...state, notes: [] }))
        yield* SubscriptionRef.update(estate, (state) => ({ ...state, impacts: [] }))
        const sent = yield* Fiber.join(frames)
        expect(Array.from(sent).map((frame) => frame._tag)).toEqual(["Whole", "Changed"])
      }),
    ))
})

describe("what runners decode of each other", () => {
  test("keeps what a firing's alert said, and takes what resolved from an owner that sends no alert id", () => {
    const said = { severity: "critical", summary: "p99 over 2s", runbook: "https://wiki.example/orders", store: "db" }
    const firing = { environment: "production", alert: "a1", name: "OrdersSlow", startsAt: "2026-10-06T09:00:00Z" }
    const parts = decodeParts({ firings: [{ ...firing, ...said }] })
    expect(Result.isSuccess(parts) ? parts.success.firings : undefined).toEqual([{ ...firing, ...said }])
    const resolved = { name: "Gone", labels: {}, startsAt: "2026-10-06T09:00:00Z", endsAt: "2026-10-06T09:10:00Z" }
    const older = decodeEnvironment({ ...environment(), resolved: [resolved] })
    expect(Result.isSuccess(older) ? older.success.resolved : undefined).toEqual([{ alert: "", ...resolved }])
  })
})
