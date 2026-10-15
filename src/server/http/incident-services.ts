/** *Add a service*: an operator adds a service or store to an open incident, kept on its record and as its event. */
import { Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { happenedOnIncident } from "../happened"
import { keepRunUp } from "../rebuilt"
import { Estate } from "../state"
import { isoNow } from "../time"
import { incidentServices } from "../views/incident-scope"
import { answered, keep, malformed, oneAtATime, open, operator, refuse } from "./incident-record"
import { json } from "./routes"

const Asked = Schema.Struct({ service: Schema.String })

export const incidentServicesRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/services",
  Effect.gen(function* () {
    const person = yield* operator
    const { id = "" } = yield* HttpRouter.params
    const asked = yield* HttpServerRequest.schemaBodyJson(Asked).pipe(
      Effect.mapError(malformed("a service is added by its name")),
    )
    const service = asked.service.trim()
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const { services, stores = [] } = estate.catalog
    if (![...services, ...stores].some((each) => each.name === service))
      return yield* refuse(400, `the catalog names no service or store ${service}`)
    const at = yield* isoNow
    const { was, now } = yield* oneAtATime(
      Effect.gen(function* () {
        const incident = yield* open(id)
        if (incidentServices(yield* SubscriptionRef.get(yield* Estate), incident).includes(service))
          return yield* refuse(400, `"${incident.title}" already has ${service}`)
        const now = { ...incident, added: [...(incident.added ?? []), { service, by: person.name, at }] }
        yield* keep(now)
        return { was: incident, now }
      }),
    )
    yield* happenedOnIncident(id, person.name, "service-added", service, service)
    yield* keepRunUp(was, now)
    return json(now, 201)
  }).pipe(answered),
)
