/**
 * Notes written on an incident, shown on each of its firings' cards: anyone who may write adds one while it is open,
 * and its author or an operator removes one. Each is kept on the incident's record, and is an event on every firing.
 */
import { Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { longestNote } from "../../shared/note"
import { happenedOnEach } from "../happened"
import { Configured } from "../settings"
import { isoNow } from "../time"
import { answered, keep, keyOf, malformed, oneAtATime, open, refuse } from "./incident-record"
import { json, writer } from "./routes"

const Asked = Schema.Struct({ text: Schema.String })

/** Anyone who may write, where Estate keeps incidents. */
export const noteWriter = Effect.gen(function* () {
  const person = yield* writer
  if ((yield* Configured).readOnly === true)
    return yield* refuse(403, "Estate is read-only here: it keeps no incidents")
  return person
})

const addRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/notes",
  Effect.gen(function* () {
    const person = yield* noteWriter
    const { id = "" } = yield* HttpRouter.params
    const asked = yield* HttpServerRequest.schemaBodyJson(Asked).pipe(Effect.mapError(malformed("a note is its text")))
    const text = asked.text.trim()
    if (text === "" || text.length > longestNote) return yield* refuse(400, `a note is 1 to ${longestNote} characters`)
    const note = { id: crypto.randomUUID(), at: yield* isoNow, by: person.name, text }
    const now = yield* oneAtATime(
      Effect.gen(function* () {
        const incident = yield* open(id)
        const now = { ...incident, notes: [...(incident.notes ?? []), note] }
        yield* keep(now)
        return now
      }),
    )
    yield* happenedOnEach(now.firings.map(keyOf), person.name, "incident-noted", text)
    return json(now, 201)
  }).pipe(answered),
)

const removeRoute = HttpRouter.add(
  "DELETE",
  "/api/incidents/:id/notes/:note",
  Effect.gen(function* () {
    const person = yield* noteWriter
    const { id = "", note: noteId = "" } = yield* HttpRouter.params
    const { now, note } = yield* oneAtATime(
      Effect.gen(function* () {
        const incident = yield* open(id)
        const note = incident.notes?.find((each) => each.id === noteId)
        if (note === undefined) return yield* refuse(404, "there is no such note")
        if (note.by !== person.name && person.role !== "operator")
          return yield* refuse(403, "a note is removed by whoever wrote it, or an operator")
        const now = { ...incident, notes: (incident.notes ?? []).filter((each) => each !== note) }
        yield* keep(now)
        return { now, note }
      }),
    )
    // The removal keeps what the note said: the timeline is a record, not what was left.
    yield* happenedOnEach(
      now.firings.map(keyOf),
      person.name,
      "incident-note-removed",
      `a note by ${note.by}: ${note.text}`,
    )
    return json(now)
  }).pipe(answered),
)

export const incidentNoteRoutes = Layer.mergeAll(addRoute, removeRoute)
