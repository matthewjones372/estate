/**
 * `PUT /api/impacts/:alert`: an operator writes what an alert, by its name, means for the people using the product.
 * It is kept for every later firing, in every environment, until someone changes it; empty text forgets it.
 */
import { Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { happened } from "../happened"
import { Notes } from "../notes"
import { Estate } from "../state"
import { isoNow } from "../time"
import { written } from "../writes"
import { json, Refusal, refused, writer } from "./routes"

const Asked = Schema.Struct({ text: Schema.String })

const longest = 500

export const impactRoute = HttpRouter.add(
  "PUT",
  "/api/impacts/:alert",
  Effect.gen(function* () {
    const person = yield* writer
    if (person.role !== "operator") return json({ message: "an alert's impact is written by operators" }, 403)
    const { alert = "" } = yield* HttpRouter.params
    const asked = yield* HttpServerRequest.schemaBodyJson(Asked).pipe(
      Effect.mapError(() => new Refusal({ status: 400, body: { message: "an impact is its text" } })),
    )
    const text = asked.text.trim()
    if (text.length > longest) return json({ message: `an impact is at most ${longest} characters` }, 400)
    const impact = { alert, text, by: person.name, at: yield* isoNow }
    const notes = yield* Notes
    const kept = yield* Effect.result(notes.setImpact(impact))
    if (kept._tag === "Failure") return json({ message: kept.failure.message }, 503)
    yield* written(text === "" ? { _tag: "ImpactCleared", alert } : { _tag: "ImpactSet", impact })
    // An impact is the alert's, by name, so each of its firings now has it as an event.
    const { environments } = yield* SubscriptionRef.get(yield* Estate)
    const firings = Object.entries(environments).flatMap(([environment, state]) =>
      (state.alerts.value ?? [])
        .filter((each) => each.name === alert)
        .map((each) => ({ environment, alert: each.id, startsAt: each.startsAt })),
    )
    yield* Effect.forEach(
      firings,
      (firing) => happened(firing, person.name, "impact-written", text === "" ? "cleared the impact" : text),
      { discard: true },
    )
    return json(impact, 200)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
