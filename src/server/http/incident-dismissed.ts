/**
 * *Not this*: an operator says a live firing is not part of an open incident (spec 0042). It is kept on the incident's
 * record, by firing, so the same alert firing again can be suggested again; and it is an event on the firing.
 */
import { Effect, Schema } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { happened } from "../happened"
import { sameFiring } from "../notes"
import { isoNow } from "../time"
import { answered, keep, keyOf, live, malformed, oneAtATime, open, operator, refuse } from "./incident-record"
import { json } from "./routes"

const Dismissed = Schema.Struct({ environment: Schema.String, alert: Schema.String })

export const incidentDismissedRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/dismissed",
  Effect.gen(function* () {
    const person = yield* operator
    const { id = "" } = yield* HttpRouter.params
    const asked = yield* HttpServerRequest.schemaBodyJson(Dismissed).pipe(
      Effect.mapError(malformed("a firing is an environment and an alert")),
    )
    const firing = yield* live(asked.environment, asked.alert)
    const at = yield* isoNow
    const now = yield* oneAtATime(
      Effect.gen(function* () {
        const incident = yield* open(id)
        if (incident.firings.some((one) => sameFiring(one, firing)))
          return yield* refuse(400, `${asked.alert} is part of "${incident.title}": unlink it instead`)
        if ((incident.dismissed ?? []).some((one) => sameFiring(one, firing))) return { incident, said: false }
        const dismissed = [...(incident.dismissed ?? []), { ...keyOf(firing), by: person.name, at }]
        const now = { ...incident, dismissed }
        yield* keep(now)
        return { incident: now, said: true }
      }),
    )
    if (now.said) yield* happened(firing, person.name, "incident-dismissed", now.incident.title)
    return json(now.incident)
  }).pipe(answered),
)
