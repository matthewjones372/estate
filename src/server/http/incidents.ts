/**
 * Incidents: firings an operator links as one problem, from any environment, kept until a person closes one with how
 * it ended. Operators open, link, unlink and close; anyone who can read the page reads them. Each change is an event
 * on the firings it touches, and a firing is in one incident at most, so linking it elsewhere moves it.
 */
import { Effect, Layer, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http"
import { longestNote } from "../../shared/events"
import type { Incident } from "../../shared/incidents"
import { firingNow, happened } from "../happened"
import { Notes, sameFiring } from "../notes"
import type { FiringKey } from "../notes-events"
import { Configured } from "../settings"
import type { SourceFailure } from "../sources/run"
import { Estate } from "../state"
import { isoNow } from "../time"
import { written } from "../writes"
import { json, Refusal, refused, searchParams, withRole, writer } from "./routes"

const longestTitle = 200

const Opened = Schema.Struct({ title: Schema.String, environment: Schema.String, alert: Schema.String })
const Linked = Schema.Struct({ environment: Schema.String, alert: Schema.String })
const Unlinked = Schema.Struct({ env: Schema.String, alert: Schema.String })
const Closed = Schema.Struct({ how: Schema.String })

const refuse = (status: Refusal["status"], message: string): Effect.Effect<never, Refusal> =>
  Effect.fail(new Refusal({ status, body: { message } }))

const malformed = (message: string) => () => new Refusal({ status: 400, body: { message } })

const operator = Effect.gen(function* () {
  const person = yield* writer
  if ((yield* Configured).readOnly === true)
    return yield* refuse(403, "Estate is read-only here: it keeps no incidents")
  return person.role === "operator" ? person : yield* refuse(403, "incidents are kept by operators")
})

const kept = Effect.map(Effect.flatMap(Estate, SubscriptionRef.get), (estate) => estate.incidents ?? [])

const named = (id: string) =>
  Effect.flatMap(kept, (incidents) => {
    const found = incidents.find((each) => each.id === id)
    return found === undefined ? refuse(404, "there is no such incident") : Effect.succeed(found)
  })

/** The incident, while it is open: a closed one is the record of how it went, and changes no more. */
const open = (id: string) =>
  Effect.flatMap(named(id), (incident) =>
    incident.closedAt === undefined ? Effect.succeed(incident) : refuse(400, `"${incident.title}" is closed`),
  )

const live = (environment: string, alert: string) =>
  Effect.flatMap(firingNow(environment, alert), (firing) =>
    firing === undefined ? refuse(404, `${alert} is not firing in ${environment}`) : Effect.succeed(firing),
  )

const keyOf = ({ environment, alert, startsAt }: FiringKey): FiringKey => ({ environment, alert, startsAt })

/** The incident kept, and shown wherever the estate is read. */
const keep = (incident: Incident) =>
  Effect.gen(function* () {
    yield* (yield* Notes).keepIncident(incident)
    yield* written({ _tag: "IncidentKept", incident })
  })

/** The firing in `incident`, taken first out of any other it was in. */
const linked = (incident: Incident, firing: FiringKey, by: string) =>
  Effect.gen(function* () {
    const was = (yield* kept).find(
      (each) => each.id !== incident.id && each.firings.some((one) => sameFiring(one, firing)),
    )
    if (was !== undefined) {
      yield* keep({ ...was, firings: was.firings.filter((one) => !sameFiring(one, firing)) })
      yield* happened(firing, by, "incident-unlinked", was.title)
    }
    const now = { ...incident, firings: [...incident.firings, { ...firing, linkedBy: by, linkedAt: yield* isoNow }] }
    yield* keep(now)
    return now
  })

/** A store that cannot be read or written is a 503, saying why; a refusal is its own answer. */
const answered = <R>(route: Effect.Effect<HttpServerResponse.HttpServerResponse, SourceFailure | Refusal, R>) =>
  route.pipe(
    Effect.catchTag("SourceFailure", (failure) => Effect.succeed(json({ message: failure.message }, 503))),
    Effect.catchTag("Refusal", refused),
  )

const openRoute = HttpRouter.add(
  "POST",
  "/api/incidents",
  Effect.gen(function* () {
    const person = yield* operator
    const asked = yield* HttpServerRequest.schemaBodyJson(Opened).pipe(
      Effect.mapError(malformed("an incident is a title, an environment and an alert")),
    )
    const title = asked.title.trim()
    if (title === "" || title.length > longestTitle)
      return yield* refuse(400, `an incident's title is 1 to ${longestTitle} characters`)
    const firing = yield* live(asked.environment, asked.alert)
    const incident = yield* linked(
      { id: crypto.randomUUID(), title, openedBy: person.name, openedAt: yield* isoNow, firings: [] },
      firing,
      person.name,
    )
    yield* happened(firing, person.name, "incident-opened", title)
    return json(incident, 201)
  }).pipe(answered),
)

const linkRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/firings",
  Effect.gen(function* () {
    const person = yield* operator
    const { id = "" } = yield* HttpRouter.params
    const asked = yield* HttpServerRequest.schemaBodyJson(Linked).pipe(
      Effect.mapError(malformed("a firing is an environment and an alert")),
    )
    const incident = yield* open(id)
    const firing = yield* live(asked.environment, asked.alert)
    if (incident.firings.some((one) => sameFiring(one, firing))) return json(incident)
    const now = yield* linked(incident, firing, person.name)
    yield* happened(firing, person.name, "incident-linked", incident.title)
    return json(now)
  }).pipe(answered),
)

const unlinkRoute = HttpRouter.add(
  "DELETE",
  "/api/incidents/:id/firings",
  Effect.gen(function* () {
    const person = yield* operator
    const { id = "" } = yield* HttpRouter.params
    const { env, alert } = yield* searchParams(Unlinked, "env and alert name the firing")
    const incident = yield* open(id)
    // Its latest firing of that alert there, which is the live one if the alert still fires.
    const firing = incident.firings
      .filter((one) => one.environment === env && one.alert === alert)
      .toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))[0]
    if (firing === undefined) return yield* refuse(404, `${alert} in ${env} is not part of "${incident.title}"`)
    const now = { ...incident, firings: incident.firings.filter((one) => one !== firing) }
    yield* keep(now)
    yield* happened(keyOf(firing), person.name, "incident-unlinked", incident.title)
    return json(now)
  }).pipe(answered),
)

const closeRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/close",
  Effect.gen(function* () {
    const person = yield* operator
    const { id = "" } = yield* HttpRouter.params
    const asked = yield* HttpServerRequest.schemaBodyJson(Closed).pipe(
      Effect.mapError(malformed("an incident is closed with how it ended")),
    )
    const how = asked.how.trim()
    if (how === "" || how.length > longestNote)
      return yield* refuse(400, `how it ended is 1 to ${longestNote} characters`)
    const incident = yield* open(id)
    const now = { ...incident, closedBy: person.name, closedAt: yield* isoNow, ended: how }
    yield* keep(now)
    yield* Effect.forEach(incident.firings, (firing) => happened(keyOf(firing), person.name, "incident-closed", how), {
      discard: true,
    })
    return json(now)
  }).pipe(answered),
)

/** An incident, with every event of its firings merged in time order, each saying which firing it was on. */
const readRoute = HttpRouter.add(
  "GET",
  "/api/incidents/:id",
  Effect.gen(function* () {
    yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const incident = yield* named(id)
    const notes = yield* Notes
    const events = yield* Effect.forEach(incident.firings, (firing) =>
      Effect.map(notes.events(keyOf(firing)), (all) => all.map(({ startsAt: _, ...event }) => event)),
    )
    return json({ incident, events: events.flat().toSorted((a, b) => a.at.localeCompare(b.at)) })
  }).pipe(answered),
)

/** The incidents open now, newest first, for a card to offer to link to. */
const listRoute = HttpRouter.add(
  "GET",
  "/api/incidents",
  Effect.gen(function* () {
    yield* withRole
    const incidents = (yield* kept)
      .filter((each) => each.closedAt === undefined)
      .toSorted((a, b) => b.openedAt.localeCompare(a.openedAt))
    return json({ incidents })
  }).pipe(Effect.catchTag("Refusal", refused)),
)

export const incidentRoutes = Layer.mergeAll(openRoute, linkRoute, unlinkRoute, closeRoute, readRoute, listRoute)
