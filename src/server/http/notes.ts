/** `POST /api/notes`: anyone who may see the estate adds a note to an alert, under their own name. */
import { Clock, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { Notes } from "../notes"
import { Estate, updateEstate } from "../state"
import { json, refused, withRole } from "./routes"

const Asked = Schema.Struct({ environment: Schema.String, alert: Schema.String, text: Schema.String })

const longest = 2000
const kept = 500

export const notesRoute = HttpRouter.add(
  "POST",
  "/api/notes",
  Effect.gen(function* () {
    const person = yield* withRole
    const asked = yield* HttpServerRequest.schemaBodyJson(Asked).pipe(
      Effect.mapError(
        () => ({ status: 400, body: { message: "a note is an environment, an alert and its text" } }) as const,
      ),
    )
    const text = asked.text.trim()
    if (text === "" || text.length > longest) return json({ message: `a note is 1 to ${longest} characters` }, 400)
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    if (!catalog.environments.some((each) => each.name === asked.environment))
      return json({ message: `${asked.environment} is not an environment` }, 404)
    const note = {
      id: crypto.randomUUID(),
      environment: asked.environment,
      alert: asked.alert,
      at: new Date(yield* Clock.currentTimeMillis).toISOString(),
      by: person.name,
      text,
    }
    const notes = yield* Notes
    const added = yield* Effect.result(notes.add(note))
    if (added._tag === "Failure") return json({ message: added.failure.message }, 503)
    yield* updateEstate((estate) => ({ ...estate, notes: [note, ...estate.notes].slice(0, kept) }))
    return json(note, 201)
  }).pipe(Effect.catch((refusal) => refused(refusal))),
)

/** The notes already kept, into the state as Estate starts; tried again until the database answers. */
export const loadNotes = Effect.gen(function* () {
  const notes = yield* Notes
  const all = yield* notes.all
  yield* updateEstate((estate) => ({ ...estate, notes: all }))
})
