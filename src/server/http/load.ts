/**
 * `GET /api/load?env=&service=&range=` and `GET /api/store-load?env=&store=&range=`: a service's load, or a store's
 * stats, over a longer range than the stream's hour; `from=&to=` in place of `range=` reads a window in the past.
 */
import { Clock, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { windowOf } from "../../shared/window"
import { Configured } from "../settings"
import { loadOf, storeLoadOf } from "../sources/metrics"
import type { Span } from "../sources/prometheus"
import { rangesIn } from "../sources/ranges"
import { Estate } from "../state"
import { storesIn } from "../views/stores"
import { json, refused, searchParams, withRole } from "./routes"

const spans = {
  "1h": { seconds: 3600, step: 60 },
  "6h": { seconds: 6 * 3600, step: 300 },
  "24h": { seconds: 24 * 3600, step: 900 },
  "7d": { seconds: 7 * 24 * 3600, step: 3600 },
} as const satisfies Readonly<Record<string, Span>>

const Asked = Schema.Struct({
  env: Schema.String,
  service: Schema.String,
  range: Schema.optionalKey(Schema.Literals(["1h", "6h", "24h", "7d"])),
  from: Schema.optionalKey(Schema.String),
  to: Schema.optionalKey(Schema.String),
})

const askedFor = "load is asked for by env, service and a range of 1h, 6h, 24h or 7d, or a from and a later to"

/** The span asked for, and when it ends: a range ending now, or the window from `from` to `to`. */
const spanOf = (asked: typeof Asked.Type, now: number): readonly [Span, number] | undefined => {
  if (asked.range !== undefined) return [spans[asked.range], now]
  const [from, to] = [Date.parse(asked.from ?? ""), Date.parse(asked.to ?? "")]
  if (Number.isNaN(from) || Number.isNaN(to) || from >= to) return undefined
  const window = windowOf(from, Math.min(to, now))
  return [{ seconds: window.end - window.start, step: window.step }, window.end * 1000]
}

export const loadRoute = HttpRouter.add(
  "GET",
  "/api/load",
  Effect.gen(function* () {
    yield* withRole
    const asked = yield* searchParams(Asked, askedFor)
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const environment = catalog.environments.find((each) => each.name === asked.env)
    const service = catalog.services.find(
      (each) =>
        each.name === asked.service && environment !== undefined && each.environments.includes(environment.name),
    )
    const spanned = spanOf(asked, yield* Clock.currentTimeMillis)
    if (spanned === undefined) return json({ message: askedFor }, 400)
    const [span, end] = spanned
    if (environment === undefined || service === undefined)
      return json({ message: "no such environment or service" }, 404)
    const ranges = yield* rangesIn(settings.sources[environment.sources] ?? {})
    if (ranges === undefined) return json({ message: `${environment.name} has no metrics to read` }, 404)
    return json(yield* loadOf(ranges, service, span, end))
  }).pipe(Effect.catchTag("Refusal", refused)),
)

const AskedOfStore = Schema.Struct({
  env: Schema.String,
  store: Schema.String,
  range: Schema.Literals(["1h", "6h", "24h", "7d"]),
})

export const storeLoadRoute = HttpRouter.add(
  "GET",
  "/api/store-load",
  Effect.gen(function* () {
    yield* withRole
    const asked = yield* searchParams(
      AskedOfStore,
      "a store's stats are asked for by env, store and a range of 1h, 6h, 24h or 7d",
    )
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const environment = catalog.environments.find((each) => each.name === asked.env)
    const store = storesIn(catalog, asked.env).find((each) => each.name === asked.store)
    if (environment === undefined || store === undefined) return json({ message: "no such environment or store" }, 404)
    const ranges = yield* rangesIn(settings.sources[environment.sources] ?? {})
    if (ranges === undefined) return json({ message: `${environment.name} has no metrics to read` }, 404)
    const now = yield* Clock.currentTimeMillis
    const readings = yield* storeLoadOf(ranges, store, spans[asked.range], now)
    return json({ stats: readings.map(({ key: _, ...stat }) => stat) })
  }).pipe(Effect.catchTag("Refusal", refused)),
)
