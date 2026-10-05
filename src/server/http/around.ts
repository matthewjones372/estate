/** `GET /api/alerts/:id/around?env=`: an alert's brief — what changed near it, depends, history, runbook. */
import { Effect, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { Estate } from "../state"
import { aroundOf } from "../views/around"
import { EnvParam, json, refused, searchParams, withRole } from "./routes"

export const aroundRoute = HttpRouter.add(
  "GET",
  "/api/alerts/:id/around",
  Effect.gen(function* () {
    yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const { env: asked } = yield* searchParams(EnvParam, "env names an environment")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? estate.catalog.environments[0]?.name ?? ""
    if (!estate.catalog.environments.some((each) => each.name === environment))
      return json({ message: `${environment} is not an environment` }, 404)
    const brief = aroundOf(estate, environment, id)
    if (brief === undefined) return json({ message: `there is no alert ${id}` }, 404)
    return json(brief)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
