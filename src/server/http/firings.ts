/** `GET /api/firings/:id?env=&at=`: one past firing of an alert, for its page. */
import { Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { Estate } from "../state"
import { pastFiring } from "../views/firing"
import { json, refused, searchParams, withRole } from "./routes"

const FiringAsked = Schema.Struct({ env: Schema.optionalKey(Schema.String), at: Schema.String })

export const firingRoute = HttpRouter.add(
  "GET",
  "/api/firings/:id",
  Effect.gen(function* () {
    yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { env: asked, at } = yield* searchParams(FiringAsked, "at says when the firing started")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? estate.catalog.environments[0]?.name ?? ""
    const firing = pastFiring(estate, environment, id, at)
    return firing === undefined
      ? json({ message: `no firing of ${id} in ${environment} started at ${at} is kept` }, 404)
      : json(firing)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
