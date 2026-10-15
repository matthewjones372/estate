/**
 * Incidents: firings an operator links as one problem, from any environment, kept until a person closes one with how
 * it ended. Operators open, link, unlink and close; anyone who can read the page reads them. Each change is an event
 * on the firings it touches, and a firing is in one incident at most, so linking it elsewhere moves it.
 */
import { Effect, Layer, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { compact } from "../../shared/compact"
import { versionsOf } from "../../shared/incident-versions"
import type { Incident } from "../../shared/incidents"
import { longestNote } from "../../shared/note"
import { seenBy } from "../../shared/timeline"
import { keepEvidence } from "../evidence"
import { happened, happenedOnEach } from "../happened"
import { incidentTimeline } from "../incident-timeline"
import { Notes, sameFiring } from "../notes"
import type { FiringKey } from "../notes-events"
import { keepAtClose, keepRunUp } from "../rebuilt"
import { Configured } from "../settings"
import { leadMinutes, suggestWithin } from "../settings-incidents"
import { Estate } from "../state"
import { isoNow, sameInstant } from "../time"
import { incidentServices, incidentWindow } from "../views/incident-scope"
import { mayBelongTo } from "../views/suggested"
import { incidentDismissedRoute } from "./incident-dismissed"
import { incidentEvidenceRoute } from "./incident-evidence"
import { incidentHappenedRoute } from "./incident-happened"
import { incidentNoteRoutes } from "./incident-notes"
import { incidentRaiseRoute } from "./incident-raise"
import {
  answered,
  keep,
  kept,
  keyOf,
  live,
  malformed,
  named,
  oneAtATime,
  open,
  operator,
  refuse,
} from "./incident-record"
import { incidentServicesRoute } from "./incident-services"
import { json, readsLogs, refused, searchParams, withRole } from "./routes"

const longestTitle = 200

const Opened = Schema.Struct({ title: Schema.String, environment: Schema.String, alert: Schema.String })
const Linked = Schema.Struct({ environment: Schema.String, alert: Schema.String })
const Unlinked = Schema.Struct({ env: Schema.String, alert: Schema.String, at: Schema.optionalKey(Schema.String) })
const Closed = Schema.Struct({ how: Schema.String })

/** What a firing is called, for the incident to keep; apart from the key, which is spread into the firing's events. */
const nameOf = (firing: FiringKey) =>
  Effect.map(
    Effect.flatMap(Estate, SubscriptionRef.get),
    (estate) => estate.environments[firing.environment]?.alerts.value?.find((each) => each.id === firing.alert)?.name,
  )

/** The firing in `incident`, taken first out of any other open one it was in; a closed one keeps its record. */
const linked = (incident: Incident, firing: FiringKey, by: string) =>
  Effect.gen(function* () {
    const was = (yield* kept).find(
      (each) =>
        each.id !== incident.id && each.closedAt === undefined && each.firings.some((one) => sameFiring(one, firing)),
    )
    if (was !== undefined) {
      yield* keep({ ...was, firings: was.firings.filter((one) => !sameFiring(one, firing)) })
      yield* happened(firing, by, "incident-unlinked", was.title)
    }
    const name = yield* nameOf(firing)
    const one = { ...firing, ...(name === undefined ? {} : { name }), linkedBy: by, linkedAt: yield* isoNow }
    const now = { ...incident, firings: [...incident.firings, one] }
    yield* keep(now)
    return now
  })

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
    const incident = yield* oneAtATime(
      linked(
        { id: crypto.randomUUID(), title, openedBy: person.name, openedAt: yield* isoNow, firings: [] },
        firing,
        person.name,
      ),
    )
    yield* happened(firing, person.name, "incident-opened", title)
    yield* keepRunUp(undefined, incident)
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
    const firing = yield* live(asked.environment, asked.alert)
    const now = yield* oneAtATime(
      Effect.gen(function* () {
        const incident = yield* open(id)
        if (incident.firings.some((one) => sameFiring(one, firing))) return { incident, was: incident, linked: false }
        return { incident: yield* linked(incident, firing, person.name), was: incident, linked: true }
      }),
    )
    if (now.linked) yield* happened(firing, person.name, "incident-linked", now.incident.title)
    yield* keepRunUp(now.was, now.incident)
    return json(now.incident)
  }).pipe(answered),
)

const unlinkRoute = HttpRouter.add(
  "DELETE",
  "/api/incidents/:id/firings",
  Effect.gen(function* () {
    const person = yield* operator
    const { id = "" } = yield* HttpRouter.params
    const { env, alert, at } = yield* searchParams(Unlinked, "env and alert name the firing, and at when it started")
    const { now, firing } = yield* oneAtATime(
      Effect.gen(function* () {
        const incident = yield* open(id)
        // The firing that started `at`; without it, its latest of that alert there, the live one if it still fires.
        const firing = incident.firings
          .filter(
            (one) =>
              one.environment === env && one.alert === alert && (at === undefined || sameInstant(one.startsAt, at)),
          )
          .toSorted((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0]
        if (firing === undefined) return yield* refuse(404, `${alert} in ${env} is not part of "${incident.title}"`)
        const now = { ...incident, firings: incident.firings.filter((one) => one !== firing) }
        yield* keep(now)
        return { now, firing }
      }),
    )
    yield* happened(keyOf(firing), person.name, "incident-unlinked", now.title)
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
    const now = yield* oneAtATime(
      Effect.gen(function* () {
        const now = { ...(yield* open(id)), closedBy: person.name, closedAt: yield* isoNow, ended: how }
        yield* keep(now)
        return now
      }),
    )
    yield* happenedOnEach(now.firings.map(keyOf), person.name, "incident-closed", how)
    yield* keepAtClose(now)
    yield* keepEvidence(now, "Estate").pipe(
      Effect.catch((failure) => Effect.logWarning(`an incident's evidence could not be kept: ${failure.message}`)),
    )
    return json(now)
  }).pipe(answered),
)

/** An incident, with its own events and every event of its firings merged in time order, each saying where it was. */
const readRoute = HttpRouter.add(
  "GET",
  "/api/incidents/:id",
  Effect.gen(function* () {
    const person = yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const incident = yield* named(id)
    const events = yield* incidentTimeline(incident)
    const settings = yield* Configured
    // Suggestions are offers to link, so only someone who may link reads them.
    const suggested =
      person.role === "operator" && settings.readOnly !== true
        ? mayBelongTo(yield* SubscriptionRef.get(yield* Estate), id, suggestWithin(settings.incidents))
        : undefined
    const seen = seenBy(events, yield* readsLogs(person.role))
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const services = incidentServices(estate, incident)
    const window = incidentWindow(incident, leadMinutes(settings.incidents), yield* isoNow)
    const versions = versionsOf(events, services, estate.catalog.services)
    const evidence = yield* (yield* Notes).evidence(id)
    return json(
      compact({ incident, events: seen, services, versions, evidence, window, suggested, inTool: estate.inTool?.[id] }),
    )
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

export const incidentRoutes = Layer.mergeAll(
  openRoute,
  linkRoute,
  unlinkRoute,
  closeRoute,
  readRoute,
  listRoute,
  incidentNoteRoutes,
  incidentDismissedRoute,
  incidentRaiseRoute,
  incidentServicesRoute,
  incidentHappenedRoute,
  incidentEvidenceRoute,
)
