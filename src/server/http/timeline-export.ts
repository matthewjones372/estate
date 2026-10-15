/**
 * A timeline to take away, as Markdown or JSON, for anyone who can read the page:
 * `GET /api/firings/:id/timeline?env=&at=&format=md|json`, the live firing without `at`, and
 * `GET /api/incidents/:id/timeline?format=md|json`, the incident's own events and every firing's merged. A viewer's is an operator's
 * but where logs are for operators: there an AI's answer drawn from logs says only that it answered.
 */
import { Effect, Layer, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { seenBy } from "../../shared/timeline"
import type { ExportedFiring, TimelineExport } from "../../shared/timeline-export"
import { incidentTimeline } from "../incident-timeline"
import { Notes } from "../notes"
import { Estate } from "../state"
import { exportedFiring, incidentFirings } from "../views/timeline-export"
import { fileName, markdownOf } from "../views/timeline-markdown"
import { json, readsLogs, refused, searchParams, withRole } from "./routes"

const Format = Schema.optionalKey(Schema.Literals(["md", "json"]))
const FiringAsked = Schema.Struct({
  env: Schema.optionalKey(Schema.String),
  at: Schema.optionalKey(Schema.String),
  format: Format,
})
const IncidentAsked = Schema.Struct({ format: Format })

const exported = (record: TimelineExport, startsAt: string, format: "md" | "json" | undefined) => {
  const name = fileName(record.title, startsAt, format ?? "md")
  const headers = { "content-disposition": `attachment; filename="${name}"` }
  return format === "json"
    ? HttpServerResponse.text(JSON.stringify(record), { contentType: "application/json", headers })
    : HttpServerResponse.text(markdownOf(record), { contentType: "text/markdown; charset=utf-8", headers })
}

/** A firing's events, oldest first. */
const eventsOf = (firing: ExportedFiring) =>
  Effect.map(
    Effect.flatMap(Notes, (notes) => notes.events(firing)),
    (events) => events.map(({ environment: _, alert: __, startsAt: ___, ...event }) => event),
  )

const missing = (message: string) => Effect.succeed(json({ message }, 404))

const firingRoute = HttpRouter.add(
  "GET",
  "/api/firings/:id/timeline",
  Effect.gen(function* () {
    const person = yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { env: asked, at, format } = yield* searchParams(FiringAsked, "env and at are one each, format md or json")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? estate.catalog.environments[0]?.name ?? ""
    const firing = exportedFiring(estate, environment, id, at)
    if (firing === undefined)
      return yield* missing(
        `no firing of ${id} in ${environment}${at === undefined ? "" : ` started at ${at}`} is kept`,
      )
    const events = seenBy(yield* eventsOf(firing), yield* readsLogs(person.role))
    return exported({ title: firing.name, firings: [firing], events }, firing.startsAt, format)
  }).pipe(
    Effect.catchTag("SourceFailure", (failure) => Effect.succeed(json({ message: failure.message }, 503))),
    Effect.catchTag("Refusal", refused),
  ),
)

const incidentRoute = HttpRouter.add(
  "GET",
  "/api/incidents/:id/timeline",
  Effect.gen(function* () {
    const person = yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { format } = yield* searchParams(IncidentAsked, "format is md or json")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const incident = (estate.incidents ?? []).find((each) => each.id === id)
    if (incident === undefined) return yield* missing("there is no such incident")
    const firings = incidentFirings(estate, incident)
    // Each event on a firing names its alert; one on the incident itself names none.
    const events = (yield* incidentTimeline(incident)).map(({ environment, alert, ...event }) => {
      const name = firings.find((each) => each.environment === environment && each.alert === alert)?.name
      return name === undefined ? event : { ...event, alert: name }
    })
    const seen = seenBy(events, yield* readsLogs(person.role))
    const { title, firings: _, ...kept } = incident
    return exported({ title, incident: kept, firings, events: seen }, incident.openedAt, format)
  }).pipe(
    Effect.catchTag("SourceFailure", (failure) => Effect.succeed(json({ message: failure.message }, 503))),
    Effect.catchTag("Refusal", refused),
  ),
)

export const timelineExportRoutes = Layer.mergeAll(firingRoute, incidentRoute)
