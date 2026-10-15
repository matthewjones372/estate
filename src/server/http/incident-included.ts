/**
 * *Include in incident* (spec 0051): anyone who may write keeps a chart, lines or an error group on an open incident,
 * with why, as a set of its own within the incident's evidence limit. Lines and errors need someone who reads logs.
 * Removing one is an event that names it, so the page hides it; what was kept is never changed.
 */
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { sizeOf } from "../evidence-limit"
import { happenedOnIncident } from "../happened"
import { incidentTimeline } from "../incident-timeline"
import { Notes } from "../notes"
import { Configured } from "../settings"
import { evidenceBytes } from "../settings-incidents"
import { isoNow } from "../time"
import { noteWriter } from "./incident-notes"
import { answered, named as incidentNamed, malformed, open, refuse } from "./incident-record"
import { Included, includedSet, named } from "./included-set"
import { json, readsLogs } from "./routes"

const includeRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/included",
  Effect.gen(function* () {
    const person = yield* noteWriter
    const { id = "" } = yield* HttpRouter.params
    const included = yield* HttpServerRequest.schemaBodyJson(Included).pipe(
      Effect.mapError(malformed("what is included is a chart, lines or an error group, with where it was found")),
    )
    if (included.kind !== "chart" && !(yield* readsLogs(person.role)))
      return yield* refuse(403, "lines are included by those who may read them here")
    const incident = yield* open(id)
    const set = yield* includedSet(included, person.name, yield* isoNow)
    const notes = yield* Notes
    const held = (yield* notes.evidence(id)).reduce((total, each) => total + sizeOf(each), 0)
    const room = evidenceBytes((yield* Configured).incidents) - held
    if (sizeOf(set) > room)
      return yield* refuse(
        413,
        `it would pass incidents.evidence.maxMegabytes: ${Math.max(0, Math.floor(room))} bytes are left`,
      )
    yield* notes.keepEvidence(incident.id, set)
    const why = set.why === undefined ? "" : `: "${set.why}"`
    yield* happenedOnIncident(
      id,
      person.name,
      "included",
      `included ${named(included)}${why}`,
      included.service,
      set.id,
    )
    return json(set, 201)
  }).pipe(answered),
)

const removeRoute = HttpRouter.add(
  "DELETE",
  "/api/incidents/:id/included/:set",
  Effect.gen(function* () {
    const person = yield* noteWriter
    const { id = "", set = "" } = yield* HttpRouter.params
    const incident = yield* incidentNamed(id)
    const removed = new Set(
      (yield* incidentTimeline(incident)).flatMap((each) => (each.kind === "evidence-removed" ? [each.link] : [])),
    )
    const found = (yield* (yield* Notes).evidence(id)).find((each) => each.id === set && each.from === "included")
    if (found === undefined || removed.has(set)) return yield* refuse(404, `there is nothing included as ${set}`)
    if (found.keptBy !== person.name && person.role !== "operator")
      return yield* refuse(403, "only whoever included it, or an operator, removes it")
    const what = found.charts[0]?.panel ?? (found.logs?.[0]?.errors.length === 0 ? "lines" : "error")
    const service = found.charts[0]?.service ?? found.logs?.[0]?.service ?? ""
    const text = `removed ${service} ${what}, included by ${found.keptBy}`
    yield* happenedOnIncident(id, person.name, "evidence-removed", text, service, set)
    return json({ removed: set })
  }).pipe(answered),
)

export const incidentIncludedRoutes = Layer.mergeAll(includeRoute, removeRoute)
