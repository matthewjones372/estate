/**
 * *Add what happened*: anyone who may write keeps a line on an open incident, at the time it happened, any time in the
 * incident's window; for what Estate cannot see, written later than it happened (spec 0047).
 */
import { Effect, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { longestNote } from "../../shared/note"
import { Notes } from "../notes"
import { Configured } from "../settings"
import { leadMinutes } from "../settings-incidents"
import { isoNow } from "../time"
import { incidentWindow } from "../views/incident-scope"
import { noteWriter } from "./incident-notes"
import { answered, malformed, open, refuse } from "./incident-record"
import { json } from "./routes"

const Asked = Schema.Struct({ text: Schema.String, at: Schema.optionalKey(Schema.String) })

const utc = (iso: string) => `${iso.slice(0, 19).replace("T", " ")} UTC`

export const incidentHappenedRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/happened",
  Effect.gen(function* () {
    const person = yield* noteWriter
    const { id = "" } = yield* HttpRouter.params
    const asked = yield* HttpServerRequest.schemaBodyJson(Asked).pipe(
      Effect.mapError(malformed("what happened is its text, and when it happened")),
    )
    const text = asked.text.trim()
    if (text === "" || text.length > longestNote)
      return yield* refuse(400, `what happened is 1 to ${longestNote} characters`)
    const now = yield* isoNow
    const at = asked.at === undefined ? Date.parse(now) : Date.parse(asked.at)
    if (Number.isNaN(at)) return yield* refuse(400, "when it happened is a time, such as 2026-10-12T14:05:00Z")
    const incident = yield* open(id)
    const { from } = incidentWindow(incident, leadMinutes((yield* Configured).incidents), now)
    if (at < Date.parse(from) || at > Date.parse(now))
      return yield* refuse(400, `what happened is in the incident's window, from ${utc(from)} to now`)
    const event = {
      incident: id,
      id: crypto.randomUUID(),
      at: new Date(at).toISOString(),
      recordedAt: now,
      source: "written",
      by: person.name,
      kind: "happened",
      text,
    } as const
    yield* (yield* Notes).addIncidentEvent(event)
    return json(event, 201)
  }).pipe(answered),
)
