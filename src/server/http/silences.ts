/**
 * Silences, written through Alertmanager, Grafana's or Datadog with who and why: `POST /api/silences` and
 * `DELETE /api/silences/:id`, for operators. The page sees the change at once; the manager's next answer confirms it.
 */
import { Clock, Duration, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { Configured } from "../settings"
import { silencerOf } from "../sources/silencers"
import { Estate, type SourcedAlert, updateEnvironment } from "../state"
import { after, iso } from "../time"
import { EnvParam, json, Refusal, refused, searchParams, writer } from "./routes"

const Asked = Schema.Struct({
  environment: Schema.String,
  alert: Schema.String,
  minutes: Schema.Number,
  reason: Schema.String,
})

const longest = 7 * 24 * 60

const refuse = (status: Refusal["status"], message: string): Effect.Effect<never, Refusal> =>
  Effect.fail(new Refusal({ status, body: { message } }))

const operator = Effect.gen(function* () {
  const person = yield* writer
  if ((yield* Configured).readOnly === true) return yield* refuse(403, "Estate is read-only here: it silences nothing")
  return person.role === "operator" ? person : yield* refuse(403, "silencing is for operators")
})

/** The environment's silencer, or the refusal saying it has none. */
const silencerIn = (environment: string) =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const found = catalog.environments.find((each) => each.name === environment)
    if (found === undefined) return yield* refuse(404, `${environment} is not an environment`)
    const silencer = silencerOf(settings.sources[found.sources] ?? {})
    return silencer === undefined
      ? yield* refuse(404, `${environment} has no Alertmanager, Grafana or Datadog to silence with`)
      : silencer
  })

const withAlert = (environment: string, id: string, change: (alert: SourcedAlert) => SourcedAlert) =>
  updateEnvironment(environment, (state) =>
    state.alerts.value === undefined
      ? state
      : {
          ...state,
          alerts: {
            ...state.alerts,
            value: state.alerts.value.map((alert) => (alert.id === id ? change(alert) : alert)),
          },
        },
  )

export const silenceRoute = HttpRouter.add(
  "POST",
  "/api/silences",
  Effect.gen(function* () {
    const person = yield* operator
    const asked = yield* HttpServerRequest.schemaBodyJson(Asked).pipe(
      Effect.mapError(
        () =>
          new Refusal({
            status: 400,
            body: { message: "a silence is an environment, an alert, minutes and a reason" },
          }),
      ),
    )
    const reason = asked.reason.trim()
    if (reason === "") return yield* refuse(400, "a silence needs a reason, shown to everyone")
    if (!(asked.minutes >= 1 && asked.minutes <= longest))
      return yield* refuse(400, "a silence lasts a minute to a week")
    const silencer = yield* silencerIn(asked.environment)
    const { environments } = yield* SubscriptionRef.get(yield* Estate)
    const alert = environments[asked.environment]?.alerts.value?.find((each) => each.id === asked.alert)
    if (alert === undefined) return yield* refuse(404, "that alert is not firing here")
    const now = yield* Clock.currentTimeMillis
    const startsAt = iso(now)
    const endsAt = iso(after(now, Duration.minutes(asked.minutes)))
    const id = yield* silencer.silence(alert, { startsAt, endsAt, by: person.name, reason })
    yield* withAlert(asked.environment, alert.id, (each) => ({
      ...each,
      state: "silenced",
      silence: { id, by: person.name, reason, startsAt, endsAt },
    }))
    return json({ id, endsAt }, 201)
  }).pipe(
    Effect.catchTag("SourceFailure", (failure) => Effect.succeed(json({ message: failure.message }, 502))),
    Effect.catchTag("Refusal", refused),
  ),
)

export const unsilenceRoute = HttpRouter.add("DELETE", "/api/silences/:id", () =>
  Effect.gen(function* () {
    yield* operator
    const { id = "" } = yield* HttpRouter.params
    const { env: environment = "" } = yield* searchParams(EnvParam, "env names an environment")
    const silencer = yield* silencerIn(environment)
    yield* silencer.unsilence(id)
    yield* updateEnvironment(environment, (state) =>
      state.alerts.value === undefined
        ? state
        : {
            ...state,
            alerts: {
              ...state.alerts,
              value: state.alerts.value.map(({ silence: was, ...alert }) =>
                was?.id === id ? { ...alert, state: "firing" } : was === undefined ? alert : { ...alert, silence: was },
              ),
            },
          },
    )
    return json({ id }, 200)
  }).pipe(
    Effect.catchTag("SourceFailure", (failure) => Effect.succeed(json({ message: failure.message }, 502))),
    Effect.catchTag("Refusal", refused),
  ),
)
