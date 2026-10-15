/** *Keep evidence now*: an operator keeps an open incident's charts as a set of evidence beside any kept before. */
import { Effect } from "effect"
import { HttpRouter } from "effect/http"
import { keepEvidence } from "../evidence"
import { answered, open, operator, refuse } from "./incident-record"
import { json } from "./routes"

export const incidentEvidenceRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/evidence",
  Effect.gen(function* () {
    const person = yield* operator
    const { id = "" } = yield* HttpRouter.params
    const set = yield* keepEvidence(yield* open(id), person.name)
    return set === undefined ? yield* refuse(404, "no charts could be read for its services") : json(set, 201)
  }).pipe(answered),
)
