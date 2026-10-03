import { describe, expect, test } from "bun:test"
import { Effect, Layer, SubscriptionRef } from "effect"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import { memoryNotes, Notes } from "../notes"
import { SourceFailure } from "../sources/run"
import { Estate, type SourcedAlert } from "../state"
import { alertsView } from "../views/alerts"

const as = (role: "viewer" | "operator") => settings({ anonymous: { name: "gil", role } })
const put = (alert: string, body: unknown) =>
  new Request(`http://estate/api/impacts/${alert}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-03T11:46:00Z",
  labels: { alertname: "OrdersSlow" },
  impact: "Said by the rule.",
}
const firing = (more: object = {}) =>
  estate({ environments: { staging: environment({ alerts: { state: "ok", value: [slow] } }) }, ...more })

describe("an alert's impact", () => {
  test("is written by an operator, kept by the alert's name, and cleared by empty text", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("operator"), firing())
        const written = yield* ask(server, put("OrdersSlow", { text: "  Orders take minutes to place.  " }))
        const ref = yield* Effect.provide(Estate, server.context)
        const kept = (yield* SubscriptionRef.get(ref)).impacts
        const cleared = yield* ask(server, put("OrdersSlow", { text: "" }))
        return { written, kept, cleared, after: (yield* SubscriptionRef.get(ref)).impacts }
      }),
    ).then(({ written, kept, cleared, after }) => {
      expect(written.status).toBe(200)
      expect(kept).toMatchObject([{ alert: "OrdersSlow", text: "Orders take minutes to place.", by: "gil" }])
      expect(cleared.status).toBe(200)
      expect(after).toEqual([])
    }))

  test("is refused to viewers, past 500 characters, malformed, or when the store does not keep it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failing = Layer.effect(Notes)(
          Effect.map(Effect.provide(Notes, memoryNotes), (notes) => ({
            ...notes,
            setImpact: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
          })),
        )
        return [
          yield* ask(yield* serverFor(as("viewer")), put("OrdersSlow", { text: "x" })),
          yield* ask(yield* serverFor(as("operator")), put("OrdersSlow", { text: "x".repeat(501) })),
          yield* ask(yield* serverFor(as("operator")), put("OrdersSlow", { words: "x" })),
          yield* ask(yield* serverFor(as("operator"), estate(), undefined, failing), put("OrdersSlow", { text: "x" })),
        ].map((answer) => [answer.status, (answer.json() as { message: string }).message])
      }),
    ).then((answers) =>
      expect(answers).toEqual([
        [403, "an alert's impact is written by operators"],
        [400, "an impact is at most 500 characters"],
        [400, "an impact is its text"],
        [503, "the notes database: down"],
      ]),
    ))

  test("is shown as written on the page first, then as the catalog says, then as its rule says", () => {
    const page = { alert: "OrdersSlow", text: "Written on the page.", by: "ada", at: "2026-10-03T12:00:00Z" }
    const inCatalog = { ...catalog, alerts: { OrdersSlow: { impact: "Said in the catalog." } } }
    const impactOf = (state: ReturnType<typeof firing>) => alertsView(state, "staging", false).alerts[0]?.impact
    expect(impactOf(firing({ impacts: [page], catalog: inCatalog }))).toEqual({
      text: "Written on the page.",
      from: "page",
      by: "ada",
      at: "2026-10-03T12:00:00Z",
    })
    expect(impactOf(firing({ catalog: inCatalog }))).toEqual({ text: "Said in the catalog.", from: "catalog" })
    expect(impactOf(firing())).toEqual({ text: "Said by the rule.", from: "rule" })
  })
})
