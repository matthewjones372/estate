/**
 * A timeline to take away, as Markdown or JSON, for anyone who can read the page:
 * `GET /api/firings/:id/timeline?env=&at=&format=md|json`, the live firing without `at`, and
 * `GET /api/incidents/:id/timeline?format=md|json`, every firing of the incident merged. A viewer's is an operator's:
 * nothing on these pages is kept from viewers.
 */
import { Effect, Layer, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { mergedOnce } from "../../shared/timeline"
import type { ExportedFiring, TimelineExport } from "../../shared/timeline-export"
import { Notes } from "../notes"
import { Estate } from "../state"
import { exportedFiring, incidentFirings } from "../views/timeline-export"
import { fileName, markdownOf } from "../views/timeline-markdown"
import { json, refused, searchParams, withRole } from "./routes"

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

/** A firing's events, oldest first, each naming its alert where `named` says to. */
const eventsOf = (firing: ExportedFiring, named: boolean) =>
  Effect.map(
    Effect.flatMap(Notes, (notes) => notes.events(firing)),
    (events) =>
      events.map(({ environment: _, alert: __, startsAt: ___, ...event }) =>
        named ? { ...event, alert: firing.name } : event,
      ),
  )

const missing = (message: string) => Effect.succeed(json({ message }, 404))

const firingRoute = HttpRouter.add(
  "GET",
  "/api/firings/:id/timeline",
  Effect.gen(function* () {
    yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { env: asked, at, format } = yield* searchParams(FiringAsked, "env and at are one each, format md or json")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? estate.catalog.environments[0]?.name ?? ""
    const firing = exportedFiring(estate, environment, id, at)
    if (firing === undefined)
      return yield* missing(
        `no firing of ${id} in ${environment}${at === undefined ? "" : ` started at ${at}`} is kept`,
      )
    const events = yield* eventsOf(firing, false)
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
    yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { format } = yield* searchParams(IncidentAsked, "format is md or json")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const incident = (estate.incidents ?? []).find((each) => each.id === id)
    if (incident === undefined) return yield* missing("there is no such incident")
    const firings = incidentFirings(estate, incident)
    const events = mergedOnce((yield* Effect.forEach(firings, (firing) => eventsOf(firing, true))).flat())
    const { title, firings: _, ...kept } = incident
    return exported({ title, incident: kept, firings, events }, incident.openedAt, format)
  }).pipe(
    Effect.catchTag("SourceFailure", (failure) => Effect.succeed(json({ message: failure.message }, 503))),
    Effect.catchTag("Refusal", refused),
  ),
)

export const timelineExportRoutes = Layer.mergeAll(firingRoute, incidentRoute)
