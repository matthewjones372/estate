/** Estate's routes: who you are, the event stream for an environment, and the pages. */
import { Data, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import type { Me } from "../../shared/events"
import { streamClosed, streamOpened } from "../observed"
import { Configured, secondsIn } from "../settings"
import { silencerOf } from "../sources/silencers"
import { Estate } from "../state"
import { eventStream, SharedViews } from "../stream"
import { Web } from "../web"
import { type Person, personAsking } from "./people"

export const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), { status, contentType: "application/json" })

/** A request refused: the status, and the body that says why. */
export const Refusal = Data.TaggedError("Refusal")<{
  readonly status: 400 | 401 | 403 | 404 | 502
  readonly body: unknown
}>
export type Refusal = InstanceType<typeof Refusal>

/** The person asking if they hold a role, or the response that says why not. */
export const withRole: Effect.Effect<
  Person & { readonly role: Me["role"] },
  Refusal,
  HttpServerRequest.HttpServerRequest | Configured
> = Effect.gen(function* () {
  const person = yield* personAsking
  if (Option.isNone(person)) return yield* new Refusal({ status: 401, body: { signIn: "/auth/login" } })
  const { name, groups, role, kiosk } = person.value
  if (role === undefined) {
    const { auth } = yield* Configured
    const groups = [...new Set([...auth.roles.viewer, ...auth.roles.operator])]
    return yield* new Refusal({ status: 403, body: { name, groups } })
  }
  return { name, groups, role, ...(kiosk === true ? { kiosk } : {}) }
})

/** The person asking, if they may change something or read lines: anyone with a role but a screen. */
export const writer = Effect.flatMap(withRole, (person) =>
  person.kiosk === true
    ? Effect.fail(new Refusal({ status: 403, body: { message: "a screen changes nothing and reads no lines" } }))
    : Effect.succeed(person),
)

/** The query's parameters, decoded by `schema`; a query that does not fit is refused, saying what it should be. */
export const searchParams = <A, I extends Readonly<Record<string, string | ReadonlyArray<string> | undefined>>>(
  schema: Schema.Codec<A, I>,
  expected: string,
) =>
  HttpServerRequest.schemaSearchParams(schema).pipe(
    Effect.mapError(() => new Refusal({ status: 400, body: { message: expected } })),
  )

/** `?env=`, which most routes take. */
export const EnvParam = Schema.Struct({ env: Schema.optionalKey(Schema.String) })

export const refused = (refusal: Refusal) => Effect.succeed(json(refusal.body, refusal.status))

const health = HttpRouter.add("GET", "/healthz", HttpServerResponse.text("ok"))

const me = HttpRouter.add(
  "GET",
  "/api/me",
  Effect.gen(function* () {
    const person = yield* withRole
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const body: Me = {
      name: person.name,
      role: person.role,
      environments: catalog.environments.map((each) => each.name),
      ...(settings.readOnly === true ? { readOnly: true } : {}),
      ...(person.kiosk === true ? { kiosk: true } : {}),
      ...(settings.kiosk === undefined
        ? {}
        : {
            screen: {
              environments: settings.kiosk.environments ?? catalog.environments.map((each) => each.name),
              every: secondsIn(settings.kiosk.every ?? "30s") ?? 30,
            },
          }),
    }
    return json(body)
  }).pipe(Effect.catchTag("Refusal", refused)),
)

const events = HttpRouter.add("GET", "/events", (request) =>
  Effect.gen(function* () {
    const person = yield* withRole
    const ref = yield* Estate
    const { catalog } = yield* SubscriptionRef.get(ref)
    const { env: asked } = yield* searchParams(EnvParam, "env names an environment")
    const environment = asked ?? catalog.environments[0]?.name ?? ""
    const found = catalog.environments.find((each) => each.name === environment)
    if (found === undefined) return json({ message: `${environment} is not an environment` }, 404)
    const settings = yield* Configured
    const silences =
      person.role === "operator" &&
      settings.readOnly !== true &&
      silencerOf(settings.sources[found.sources] ?? {}) !== undefined
    const lastEventId = request.headers["last-event-id"]
    yield* streamOpened
    const body = eventStream({ environment, silences }, lastEventId).pipe(
      Stream.provideService(SharedViews, yield* SharedViews),
      Stream.encodeText,
      Stream.ensuring(streamClosed),
    )
    return HttpServerResponse.stream(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    })
  }).pipe(Effect.catchTag("Refusal", refused)),
)

const assets = HttpRouter.add("GET", "/assets/:name", (request) =>
  Effect.gen(function* () {
    const web = yield* Web
    const name = request.url.replace(/^\/assets\//, "").replace(/\?.*$/, "")
    return Option.match(web.asset(name), {
      onNone: () => HttpServerResponse.text("not found", { status: 404 }),
      onSome: (asset) =>
        HttpServerResponse.uint8Array(asset.body, {
          contentType: asset.type,
          headers: { "cache-control": "public, max-age=31536000, immutable" },
        }),
    })
  }),
)

const pages = HttpRouter.add(
  "GET",
  "/*",
  Effect.gen(function* () {
    const web = yield* Web
    return HttpServerResponse.text(web.index, {
      contentType: "text/html; charset=utf-8",
      headers: { "cache-control": "no-cache" },
    })
  }),
)

export const routes = Layer.mergeAll(health, me, events, assets, pages)
