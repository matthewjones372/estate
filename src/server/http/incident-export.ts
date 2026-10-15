/**
 * `GET /api/incidents/:id/export?format=zip`: everything kept of an incident, for a review or a reader without Estate
 * (spec 0047). Anyone who may read the page may take it, less what they may not read; each export is an event.
 */
import { createHash } from "node:crypto"
import { Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { strToU8, zipSync } from "fflate"
import { happenedOnIncident } from "../happened"
import { Estate } from "../state"
import { folderOf, incidentZip } from "../views/incident-zip"
import { recordFor, timelineFor } from "./incident-read"
import { answered, named } from "./incident-record"
import { readsLogs, searchParams, withRole } from "./routes"

const Asked = Schema.Struct({ format: Schema.Literal("zip") })

export const incidentExportRoute = HttpRouter.add(
  "GET",
  "/api/incidents/:id/export",
  Effect.gen(function* () {
    const person = yield* withRole
    const { id = "" } = yield* HttpRouter.params
    yield* searchParams(Asked, "an incident is exported as format=zip")
    const incident = yield* named(id)
    const reads = yield* readsLogs(person.role)
    const record = yield* recordFor(incident, reads)
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const files = incidentZip({
      timeline: yield* timelineFor(incident, reads),
      record,
      readsLogs: reads,
      catalog: createHash("sha256").update(JSON.stringify(catalog)).digest("hex").slice(0, 16),
    })
    const zipped = zipSync(Object.fromEntries(files.map(([path, text]) => [path, strToU8(text)])))
    // A screen changes nothing, so its export is not kept as one.
    if (person.kiosk !== true) yield* happenedOnIncident(id, person.name, "exported", "exported as zip")
    return HttpServerResponse.uint8Array(zipped, {
      contentType: "application/zip",
      headers: { "content-disposition": `attachment; filename="${folderOf(record)}.zip"` },
    })
  }).pipe(answered),
)
