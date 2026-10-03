import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option, Stream } from "effect"
import { estate } from "./fixture"
import { estateLayer } from "./state"
import { framesFor, rendered, SharedViews, sharedViewsLayer, viewsOf } from "./stream"

const viewer = { environment: "staging", silences: false }
const views = rendered(viewsOf(estate(), viewer, Date.parse("2026-10-03T12:00:00Z")))

describe("the stream's messages", () => {
  test("a new page is sent every part, all with the same id", () => {
    const [, frames] = framesFor(undefined, views, undefined)
    expect(frames.map((frame) => /event: (\w+)/.exec(frame)?.[1])).toEqual([
      "catalog",
      "services",
      "alerts",
      "deploys",
      "feed",
    ])
    expect(new Set(frames.map((frame) => /id: (\w+)/.exec(frame)?.[1])).size).toBe(1)
  })

  test("after that, only what changed is sent", () => {
    const [sent] = framesFor(undefined, views, undefined)
    const changed = rendered({
      ...viewsOf(estate(), viewer, Date.parse("2026-10-03T12:00:00Z")),
      feed: { items: [{ at: "2026-10-03T11:00:00Z", kind: "note" as const, text: "on it" }] },
    })
    const [, frames] = framesFor(sent, changed, undefined)
    expect(frames.map((frame) => /event: (\w+)/.exec(frame)?.[1])).toEqual(["feed"])
    expect(framesFor(sent, views, undefined)[1]).toEqual([])
  })

  test("a reconnect that already has the page is sent nothing new", () => {
    const [, frames] = framesFor(undefined, views, undefined)
    const id = /id: (\w+)/.exec(frames[0] ?? "")?.[1]
    expect(framesFor(undefined, views, id)[1]).toEqual([])
    expect(framesFor(undefined, views, "stale")[1]).toHaveLength(5)
  })
})

describe("the renderings", () => {
  test("are made once per change for everyone watching an environment, and replayed to whoever joins", () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const shared = yield* SharedViews
          const first = yield* Stream.runHead(Stream.unwrap(shared.watch(viewer)))
          const second = yield* Stream.runHead(Stream.unwrap(shared.watch(viewer)))
          const operator = yield* Stream.runHead(Stream.unwrap(shared.watch({ ...viewer, silences: true })))
          return { first, second, operator }
        }),
      ).pipe(Effect.provide(sharedViewsLayer.pipe(Layer.provide(estateLayer(estate()))))),
    ).then(({ first, second, operator }) => {
      expect(Option.isSome(first) && Option.isSome(second) && first.value === second.value).toBe(true)
      expect(Option.isSome(operator) && Option.isSome(first) && operator.value === first.value).toBe(false)
    }))
})
