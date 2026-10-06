/** `GET /api/alerts/:id/around?env=`: an alert's brief, *Around this alert*, gathered as it is asked for. */
import { Effect, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { gatherAround } from "../around"
import { Configured } from "../settings"
import { Estate } from "../state"
import { EnvParam, json, refused, searchParams, writer } from "./routes"

export const aroundRoute = HttpRouter.add(
  "GET",
  "/api/alerts/:id/around",
  Effect.gen(function* () {
    const person = yield* writer
    const { id = "" } = yield* HttpRouter.params
    const { env: asked } = yield* searchParams(EnvParam, "env names an environment")
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? catalog.environments[0]?.name ?? ""
    const { auth } = yield* Configured
    const around = yield* gatherAround(environment, id, auth.logs !== "operator" || person.role === "operator")
    return around === undefined ? json({ message: `there is no alert ${id} in ${environment}` }, 404) : json(around)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
