import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { ask, environment, estate, serverFor, settings } from "../fixture"
import { memoryNotes, Notes, type StoredEvent } from "../notes"
import { SourceFailure } from "../sources/run"
import type { SourcedAlert } from "../state"

const alert: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-03T11:46:00Z",
  labels: { alertname: "OrdersSlow" },
}
const firing = estate({ environments: { staging: environment({ alerts: { state: "ok", value: [alert] } }) } })
const viewer = settings({ anonymous: { name: "vi", role: "viewer" } })

const event = (id: string, at: string, more: Partial<StoredEvent> = {}): StoredEvent => ({
  environment: "staging",
  alert: "a1",
  startsAt: alert.startsAt,
  id,
  at,
  by: "gil",
  kind: "noted",
  text: id,
  ...more,
})

const timeline = (at: string) =>
  new Request(`http://estate/api/firings/a1/events?env=staging&at=${encodeURIComponent(at)}`)

describe("GET /api/firings/:id/events", () => {
  test("is a firing's events in order, for anyone who can read the page, however its start is written", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(viewer, firing)
        const notes = Context.get(server.context, Notes)
        yield* notes.addEvent(event("second", "2026-10-03T11:50:00.000Z", { kind: "silenced", link: "https://am/s1" }))
        yield* notes.addEvent(event("first", "2026-10-03T11:46:00.000Z", { by: "Estate", kind: "fired" }))
        const read = yield* ask(server, timeline(alert.startsAt))
        const written = yield* ask(server, timeline("2026-10-03T11:46:00.000Z"))
        const other = yield* ask(server, timeline("2026-10-02T09:00:00Z"))
        return { read, written: written.json(), other: other.json() }
      }),
    ).then(({ read, written, other }) => {
      expect(read.status).toBe(200)
      const { events } = read.json() as {
        events: ReadonlyArray<{ id: string; by: string; kind: string; link?: string }>
      }
      expect(events.map((each) => [each.id, each.by, each.kind])).toEqual([
        ["first", "Estate", "fired"],
        ["second", "gil", "silenced"],
      ])
      expect(events[1]?.link).toBe("https://am/s1")
      expect(written).toEqual(read.json())
      expect(other).toEqual({ events: [] })
    }))

  test("without a start is the live firing's, and says so when the store cannot be read", () => {
    const down = Layer.effect(Notes)(
      Effect.map(Notes, (notes) => ({
        ...notes,
        events: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
      })),
    ).pipe(Layer.provide(memoryNotes))
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(viewer, firing)
        yield* Context.get(server.context, Notes).addEvent(event("first", "2026-10-03T11:46:00.000Z"))
        const live = yield* ask(server, new Request("http://estate/api/firings/a1/events?env=staging"))
        const broken = yield* serverFor(viewer, firing, () => undefined, down)
        const refused = yield* ask(broken, timeline(alert.startsAt))
        return { live: live.json(), refused: [refused.status, refused.json()] }
      }),
    ).then(({ live, refused }) => {
      expect((live as { events: ReadonlyArray<{ id: string }> }).events.map((each) => each.id)).toEqual(["first"])
      expect(refused).toEqual([503, { message: "the notes database: down" }])
    })
  })
})
