/**
 * `GET /api/journeys?env=&journey=&minutes=`: a journey's stages over a sample of its recent traces.
 * `GET /api/traces/:id?env=&journey=`: one trace, as lanes and rows. Both read from Tempo when asked (spec 0046).
 */
import { Clock, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { traceView } from "../../shared/trace-view"
import { sampleOf } from "../../shared/traces"
import { Configured } from "../settings"
import { tempoOf } from "../sources/grafana"
import { readTrace, searchTraces, spansNamed } from "../sources/tempo"
import { Estate } from "../state"
import { journeysIn, lanesOf } from "../views/journeys"
import { json, Refusal, refused, searchParams, withRole } from "./routes"

/** How many traces a sample reads, and how many at once. */
const sampled = 50
const together = 4

const minutesOf = (asked: string | undefined) => {
  const minutes = Number(asked ?? 15)
  return Number.isFinite(minutes) ? Math.min(60, Math.max(1, Math.round(minutes))) : 15
}

/** The environment asked for, its Tempo, and the catalog. */
const reach = (asked: string | undefined) =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const env = asked ?? catalog.environments[0]?.name ?? ""
    const found = catalog.environments.find((each) => each.name === env)
    const sources = found === undefined ? undefined : settings.sources[found.sources]
    return { catalog, env, tempo: sources === undefined ? undefined : tempoOf(sources) }
  })

const JourneyAsked = Schema.Struct({
  env: Schema.optionalKey(Schema.String),
  journey: Schema.String,
  minutes: Schema.optionalKey(Schema.String),
})

export const journeyRoute = HttpRouter.add(
  "GET",
  "/api/journeys",
  Effect.gen(function* () {
    yield* withRole
    const asked = yield* searchParams(JourneyAsked, "a journey is asked for by env, journey and minutes")
    const { catalog, env, tempo } = yield* reach(asked.env)
    const journey = journeysIn(catalog, env).find((each) => each.name === asked.journey)
    if (journey === undefined || tempo === undefined)
      return yield* new Refusal({
        status: 404,
        body: { message: `${asked.journey} has no traces to read in ${env}` },
      })
    const minutes = minutesOf(asked.minutes)
    const now = yield* Clock.currentTimeMillis
    const read = yield* Effect.result(
      Effect.flatMap(
        searchTraces(
          tempo,
          spansNamed(journey.start.service, journey.start.span),
          { from: now - minutes * 60_000, to: now },
          sampled,
        ),
        (ids) => Effect.forEach(ids, (id) => readTrace(tempo, id), { concurrency: together }),
      ),
    )
    return read._tag === "Failure"
      ? json({ message: read.failure.message }, 502)
      : json(sampleOf(journey, lanesOf(catalog), read.success, minutes))
  }).pipe(Effect.catchTag("Refusal", refused)),
)

const TraceAsked = Schema.Struct({ env: Schema.optionalKey(Schema.String), journey: Schema.optionalKey(Schema.String) })

export const traceRoute = HttpRouter.add(
  "GET",
  "/api/traces/:id",
  Effect.gen(function* () {
    yield* withRole
    const { id = "" } = yield* HttpRouter.params
    const asked = yield* searchParams(TraceAsked, "a trace is asked for by env and journey")
    const { catalog, env, tempo } = yield* reach(asked.env)
    if (tempo === undefined)
      return yield* new Refusal({ status: 404, body: { message: `${env} has no traces to read` } })
    const read = yield* Effect.result(readTrace(tempo, id))
    if (read._tag === "Failure") return json({ message: read.failure.message }, 502)
    if (read.success.spans.length === 0)
      return yield* new Refusal({ status: 404, body: { message: `no trace ${id} in ${env}` } })
    const journey = journeysIn(catalog, env).find((each) => each.name === asked.journey)
    return json(traceView(read.success, lanesOf(catalog), journey))
  }).pipe(Effect.catchTag("Refusal", refused)),
)
