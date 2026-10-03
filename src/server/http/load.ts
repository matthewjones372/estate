/** `GET /api/load?env=&service=&range=`: a service's load over a longer range than the stream's hour. */
import { Clock, Effect, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { Configured } from "../settings"
import { loadOf } from "../sources/metrics"
import type { Span } from "../sources/prometheus"
import { Estate } from "../state"
import { json, refused, withRole } from "./routes"

const spans: Readonly<Record<string, Span>> = {
  "1h": { seconds: 3600, step: 60 },
  "6h": { seconds: 6 * 3600, step: 300 },
  "24h": { seconds: 24 * 3600, step: 900 },
  "7d": { seconds: 7 * 24 * 3600, step: 3600 },
}

export const loadRoute = HttpRouter.add("GET", "/api/load", (request) =>
  Effect.gen(function* () {
    yield* withRole
    const asked = new URL(request.url, "http://estate").searchParams
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const environment = catalog.environments.find((each) => each.name === asked.get("env"))
    const service = catalog.services.find(
      (each) =>
        each.name === asked.get("service") && environment !== undefined && each.environments.includes(environment.name),
    )
    const span = spans[asked.get("range") ?? ""]
    if (environment === undefined || service === undefined || span === undefined)
      return json({ message: "no such environment, service or range" }, 404)
    const prometheus = settings.sources[environment.sources]?.prometheus
    if (prometheus === undefined) return json({ message: `${environment.name} has no Prometheus` }, 404)
    const now = yield* Clock.currentTimeMillis
    return json(yield* loadOf(prometheus.url.replace(/\/$/, ""), service, span, now))
  }).pipe(Effect.catchTag("Refusal", refused)),
)
