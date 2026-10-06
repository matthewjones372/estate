/** Estate's routes: who you are, the event stream for an environment, and the pages. */
import { Data, Effect, Layer, Option, Schema, Stream, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import type { Me } from "../../shared/events"
import { streamClosed, streamOpened } from "../observed"
import { awaited, Roles, spoken } from "../role"
import { Configured, secondsIn } from "../settings"
import { silencerOf } from "../sources/silencers"
import { Estate, type EstateState } from "../state"
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

/**
 * Whether a request that changes something came from Estate's own pages. A browser says where a request came from in
 * `Sec-Fetch-Site` and `Origin`; one sent from another site, as by a form on a page someone was lured to, is refused,
 * since its cookie, or anonymous sign-in, would otherwise let it act as the person.
 */
const fromOurPages = (request: HttpServerRequest.HttpServerRequest): boolean => {
  if (request.method === "GET" || request.method === "HEAD") return true
  const site = request.headers["sec-fetch-site"]
  if (site !== undefined) return site === "same-origin" || site === "none"
  const origin = request.headers["origin"]
  return origin === undefined || URL.parse(origin)?.host === request.headers["host"]
}

/** The person asking, if they may change something or read lines: anyone with a role but a screen, from our pages. */
export const writer = Effect.gen(function* () {
  const person = yield* withRole
  if (person.kiosk === true)
    return yield* new Refusal({ status: 403, body: { message: "a screen changes nothing and reads no lines" } })
  if (!fromOurPages(yield* HttpServerRequest.HttpServerRequest))
    return yield* new Refusal({ status: 403, body: { message: "changes are made from Estate's own pages" } })
  return person
})

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

/** Liveness: the process answers. */
const health = HttpRouter.add("GET", "/healthz", HttpServerResponse.text("ok"))

const parts = ["metrics", "alerts", "cluster", "deploys"] as const

/** What Estate has yet to read once: each part an environment is configured to read, and builds. */
const unread = (estate: EstateState): ReadonlyArray<string> => [
  ...Object.entries(estate.environments).flatMap(([name, environment]) =>
    parts.filter((part) => environment[part].state === "waiting").map((part) => `${name} ${part}`),
  ),
  ...(estate.builds.state === "waiting" ? ["builds"] : []),
]

/**
 * Readiness: every configured part read once, whether it answered or failed. A tool that is down is shown on the
 * page as down; it does not keep Estate out of service.
 */
const ready = HttpRouter.add(
  "GET",
  "/readyz",
  Effect.gen(function* () {
    const role = yield* SubscriptionRef.get(yield* Roles)
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const owners = awaited(
      role,
      estate.catalog.environments.map((each) => each.name),
    )
    if (owners.length > 0)
      return HttpServerResponse.text(`waiting for the owners of ${owners.join(", ")}`, { status: 503 })
    const waiting = unread(estate)
    const as = spoken(role)
    return waiting.length === 0
      ? HttpServerResponse.text(as === "" ? "ready" : `ready, ${as}`)
      : HttpServerResponse.text(`waiting for ${waiting.join(", ")}`, { status: 503 })
  }),
)

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
      ...(settings.ai === undefined ? {} : { ai: true }),
      ...(settings.slack === undefined || settings.readOnly === true ? {} : { slack: true }),
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

/**
 * The pages' shell, to anyone: it holds no estate, which comes over the signed-in event stream. Nothing read from a
 * tool or the catalog goes into it, or it is shown to people who have not signed in.
 */
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

export const routes = Layer.mergeAll(health, ready, me, events, assets, pages)
