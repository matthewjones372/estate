/** `POST /api/notes`: anyone who may see the estate adds a note to an alert, under their own name. */
import { Clock, Effect, Schedule, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { Notes } from "../notes"
import { Estate, updateEstate } from "../state"
import { json, Refusal, refused, withRole } from "./routes"

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
        () => new Refusal({ status: 400, body: { message: "a note is an environment, an alert and its text" } }),
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
  }).pipe(Effect.catchTag("Refusal", refused)),
)

/** `DELETE /api/notes/:id`: a note taken back by whoever wrote it, or by an operator. */
export const removeNoteRoute = HttpRouter.add(
  "DELETE",
  "/api/notes/:id",
  Effect.gen(function* () {
    const person = yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { notes: shown } = yield* SubscriptionRef.get(yield* Estate)
    const note = shown.find((each) => each.id === id)
    if (note === undefined) return json({ message: "there is no such note" }, 404)
    if (note.by !== person.name && person.role !== "operator")
      return json({ message: "a note is removed by whoever wrote it, or an operator" }, 403)
    const notes = yield* Notes
    const removed = yield* Effect.result(notes.remove(id))
    if (removed._tag === "Failure") return json({ message: removed.failure.message }, 503)
    yield* updateEstate((estate) => ({ ...estate, notes: estate.notes.filter((each) => each.id !== id) }))
    return json({ id })
  }).pipe(Effect.catchTag("Refusal", refused)),
)

const day = 24 * 3_600_000

/** Every hour, notes older than `keepDays` removed, from the database and the page. */
export const sweepNotes = (keepDays: number) =>
  Effect.gen(function* () {
    const cutoff = new Date((yield* Clock.currentTimeMillis) - keepDays * day).toISOString()
    const notes = yield* Notes
    yield* notes.removeBefore(cutoff)
    yield* updateEstate((estate) => ({ ...estate, notes: estate.notes.filter((note) => note.at >= cutoff) }))
  }).pipe(
    Effect.catch((failure) => Effect.logWarning(`old notes could not be removed: ${failure.message}`)),
    Effect.repeat(Schedule.spaced("1 hour")),
    Effect.andThen(Effect.never),
  )

/** The notes already kept, into the state as Estate starts; tried again until the database answers. */
export const loadNotes = Effect.gen(function* () {
  const notes = yield* Notes
  const all = yield* notes.all
  yield* updateEstate((estate) => ({ ...estate, notes: all }))
})
