/** `POST /api/notes`: anyone who may see the estate adds a note to an alert, under their own name. */
import { Clock, Duration, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { Notes } from "../notes"
import { noteWritten } from "../observed"
import { forEver } from "../schedule"
import { Configured } from "../settings"
import { Estate, updateEstate } from "../state"
import { replyInThread } from "../threads"
import { before, iso, isoNow } from "../time"
import { written } from "../writes"
import { json, Refusal, refused, writer } from "./routes"

const Asked = Schema.Struct({ environment: Schema.String, alert: Schema.String, text: Schema.String })

const longest = 2000

export const notesRoute = HttpRouter.add(
  "POST",
  "/api/notes",
  Effect.gen(function* () {
    const person = yield* writer
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
      at: yield* isoNow,
      by: person.name,
      text,
    }
    const notes = yield* Notes
    const added = yield* Effect.result(notes.add(note))
    if (added._tag === "Failure") return json({ message: added.failure.message }, 503)
    yield* noteWritten
    yield* written({ _tag: "NoteAdded", note })
    yield* replyInThread((yield* Configured).slack, asked, `${person.name}: ${text}`)
    return json(note, 201)
  }).pipe(Effect.catchTag("Refusal", refused)),
)

/** `DELETE /api/notes/:id`: a note taken back by whoever wrote it, or by an operator. */
export const removeNoteRoute = HttpRouter.add(
  "DELETE",
  "/api/notes/:id",
  Effect.gen(function* () {
    const person = yield* writer
    const { id = "" } = yield* HttpRouter.params
    const { notes: shown } = yield* SubscriptionRef.get(yield* Estate)
    const note = shown.find((each) => each.id === id)
    if (note === undefined) return json({ message: "there is no such note" }, 404)
    if (note.by !== person.name && person.role !== "operator")
      return json({ message: "a note is removed by whoever wrote it, or an operator" }, 403)
    const notes = yield* Notes
    const removed = yield* Effect.result(notes.remove(id))
    if (removed._tag === "Failure") return json({ message: removed.failure.message }, 503)
    yield* written({ _tag: "NoteRemoved", id })
    return json({ id })
  }).pipe(Effect.catchTag("Refusal", refused)),
)

/** Every hour, notes older than `keepDays` removed, from the database and the page. */
export const sweepNotes = (keepDays: number) =>
  Effect.gen(function* () {
    const cutoff = iso(before(yield* Clock.currentTimeMillis, Duration.days(keepDays)))
    const notes = yield* Notes
    yield* notes.removeBefore(cutoff)
    yield* updateEstate((estate) => ({ ...estate, notes: estate.notes.filter((note) => note.at >= cutoff) }))
  }).pipe(
    Effect.catch((failure) => Effect.logWarning(`old notes could not be removed: ${failure.message}`)),
    (sweep) => forEver(sweep, "1 hour"),
  )

/** The notes and impacts already kept, into the state as Estate starts; tried again until the database answers. */
export const loadNotes = Effect.gen(function* () {
  const notes = yield* Notes
  const all = yield* notes.all
  const impacts = yield* notes.impacts
  yield* updateEstate((estate) => ({ ...estate, notes: all, impacts }))
})
