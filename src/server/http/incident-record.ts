/** An incident as its routes read and keep it: found by its id, changed only while open, kept whole in store and state. */
import { Effect, Semaphore, SubscriptionRef } from "effect"
import type { HttpServerResponse } from "effect/http"
import type { Incident } from "../../shared/incidents"
import { firingNow } from "../happened"
import { Notes } from "../notes"
import type { FiringKey } from "../notes-events"
import { Configured } from "../settings"
import type { SourceFailure } from "../sources/run"
import { Estate } from "../state"
import { written } from "../writes"
import { json, Refusal, refused, writer } from "./routes"

export const refuse = (status: Refusal["status"], message: string): Effect.Effect<never, Refusal> =>
  Effect.fail(new Refusal({ status, body: { message } }))

export const malformed = (message: string) => () => new Refusal({ status: 400, body: { message } })

export const kept = Effect.map(Effect.flatMap(Estate, SubscriptionRef.get), (estate) => estate.incidents ?? [])

export const named = (id: string) =>
  Effect.flatMap(kept, (incidents) => {
    const found = incidents.find((each) => each.id === id)
    return found === undefined ? refuse(404, "there is no such incident") : Effect.succeed(found)
  })

/** The incident, while it is open: a closed one is the record of how it went, and changes no more. */
export const open = (id: string) =>
  Effect.flatMap(named(id), (incident) =>
    incident.closedAt === undefined ? Effect.succeed(incident) : refuse(400, `"${incident.title}" is closed`),
  )

/** The person changing incidents: an operator, where Estate writes. */
export const operator = Effect.gen(function* () {
  const person = yield* writer
  if ((yield* Configured).readOnly === true)
    return yield* refuse(403, "Estate is read-only here: it keeps no incidents")
  return person.role === "operator" ? person : yield* refuse(403, "incidents are kept by operators")
})

/** The firing of `alert` in `environment` now, which only a live firing has. */
export const live = (environment: string, alert: string) =>
  Effect.flatMap(firingNow(environment, alert), (firing) =>
    firing === undefined ? refuse(404, `${alert} is not firing in ${environment}`) : Effect.succeed(firing),
  )

export const keyOf = ({ environment, alert, startsAt }: FiringKey): FiringKey => ({ environment, alert, startsAt })

const one = Semaphore.makeUnsafe(1)

/**
 * A change to incidents, from reading the record to keeping it, made while no other is: each keeps an incident whole,
 * so two at once would each keep what it read, and the later would undo the earlier.
 */
export const oneAtATime = <A, E, R>(change: Effect.Effect<A, E, R>) => one.withPermits(1)(change)

/** The incident kept, and shown wherever the estate is read. */
export const keep = (incident: Incident) =>
  Effect.gen(function* () {
    yield* (yield* Notes).keepIncident(incident)
    yield* written({ _tag: "IncidentKept", incident })
  })

/** A store that cannot be read or written is a 503, saying why; a refusal is its own answer. */
export const answered = <R>(route: Effect.Effect<HttpServerResponse.HttpServerResponse, SourceFailure | Refusal, R>) =>
  route.pipe(
    Effect.catchTag("SourceFailure", (failure) => Effect.succeed(json({ message: failure.message }, 503))),
    Effect.catchTag("Refusal", refused),
  )
