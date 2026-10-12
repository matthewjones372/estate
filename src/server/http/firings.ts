/**
 * `GET /api/firings/:id?env=&at=`: one past firing of an alert, for its page; without `at`, its latest.
 * `GET /api/firings/:id/events?env=&at=`: a firing's events, oldest first, live or past: its timeline.
 */
import { Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { Notes } from "../notes"
import { Estate } from "../state"
import { pastFiring } from "../views/firing"
import { json, refused, searchParams, withRole } from "./routes"

const FiringAsked = Schema.Struct({ env: Schema.optionalKey(Schema.String), at: Schema.optionalKey(Schema.String) })

export const firingRoute = HttpRouter.add(
  "GET",
  "/api/firings/:id",
  Effect.gen(function* () {
    yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { env: asked, at } = yield* searchParams(FiringAsked, "env and at are one each")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? estate.catalog.environments[0]?.name ?? ""
    const firing = pastFiring(estate, environment, id, at)
    return firing === undefined
      ? json(
          { message: `no firing of ${id} in ${environment}${at === undefined ? "" : ` started at ${at}`} is kept` },
          404,
        )
      : json(firing)
  }).pipe(Effect.catchTag("Refusal", refused)),
)

const sameInstant = (one: string, other: string | undefined) =>
  other !== undefined && Date.parse(one) === Date.parse(other)

export const firingEventsRoute = HttpRouter.add(
  "GET",
  "/api/firings/:id/events",
  Effect.gen(function* () {
    yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { env: asked, at } = yield* searchParams(FiringAsked, "env and at are one each")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? estate.catalog.environments[0]?.name ?? ""
    // The start as Estate holds it, so a time written another way finds the same firing; without one, the live one.
    const live = estate.environments[environment]?.alerts.value?.find(
      (alert) => alert.id === id && (at === undefined || sameInstant(alert.startsAt, at)),
    )
    const startsAt = live?.startsAt ?? pastFiring(estate, environment, id, at)?.startsAt ?? at
    if (startsAt === undefined) return json({ events: [] })
    const events = yield* (yield* Notes).events({ environment, alert: id, startsAt })
    return json({ events: events.map(({ environment: _, alert: __, startsAt: ___, ...event }) => event) })
  }).pipe(
    Effect.catchTag("SourceFailure", (failure) => Effect.succeed(json({ message: failure.message }, 503))),
    Effect.catchTag("Refusal", refused),
  ),
)
