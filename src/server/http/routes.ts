/** Estate's routes: who you are, the event stream for an environment, and the pages. */
import { Effect, Layer, Option, Stream, SubscriptionRef } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http"
import type { Me } from "../../shared/events"
import { Configured } from "../settings"
import { Estate } from "../state"
import { eventStream } from "../stream"
import { Web } from "../web"
import { type Person, personAsking } from "./people"

export const json = (body: unknown, status = 200) =>
  HttpServerResponse.text(JSON.stringify(body), { status, contentType: "application/json" })

export type Refusal = { readonly status: 401 | 403; readonly body: unknown }

/** The person asking if they hold a role, or the response that says why not. */
export const withRole: Effect.Effect<
  Person & { readonly role: Me["role"] },
  Refusal,
  HttpServerRequest.HttpServerRequest | Configured
> = Effect.gen(function* () {
  const person = yield* personAsking
  if (Option.isNone(person)) return yield* Effect.fail({ status: 401, body: { signIn: "/auth/login" } } as const)
  const { name, role } = person.value
  if (role === undefined) {
    const { auth } = yield* Configured
    const groups = [...new Set([...auth.roles.viewer, ...auth.roles.operator])]
    return yield* Effect.fail({ status: 403, body: { name, groups } } as const)
  }
  return { name, role }
})

export const refused = (refusal: Refusal) => Effect.succeed(json(refusal.body, refusal.status))

const health = HttpRouter.add("GET", "/healthz", HttpServerResponse.text("ok"))

const me = HttpRouter.add(
  "GET",
  "/api/me",
  Effect.gen(function* () {
    const person = yield* withRole
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const body: Me = {
      name: person.name,
      role: person.role,
      environments: catalog.environments.map((each) => each.name),
    }
    return json(body)
  }).pipe(Effect.catch(refused)),
)

const events = HttpRouter.add("GET", "/events", (request) =>
  Effect.gen(function* () {
    const person = yield* withRole
    const ref = yield* Estate
    const { catalog } = yield* SubscriptionRef.get(ref)
    const asked = new URL(request.url, "http://estate").searchParams.get("env")
    const environment = asked ?? catalog.environments[0]?.name ?? ""
    if (!catalog.environments.some((each) => each.name === environment)) {
      return json({ message: `${environment} is not an environment` }, 404)
    }
    const silences = person.role === "operator"
    const lastEventId = request.headers["last-event-id"]
    const body = eventStream({ environment, silences }, lastEventId).pipe(
      Stream.provideService(Estate, ref),
      Stream.encodeText,
    )
    return HttpServerResponse.stream(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    })
  }).pipe(Effect.catch(refused)),
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
