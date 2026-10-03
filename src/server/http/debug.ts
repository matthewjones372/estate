/** `POST /api/debug` and `DELETE /api/debug/:service`: an operator turns a service's debug logging on for a while, or off. */
import { Clock, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerRequest } from "effect/http"
import { Configured } from "../settings"
import { showDebug, switchOff, switchOn } from "../sources/debug"
import { clusterOf } from "../sources/kubernetes"
import { Estate } from "../state"
import { EnvParam, json, Refusal, refused, searchParams, withRole } from "./routes"

const Asked = Schema.Struct({ environment: Schema.String, service: Schema.String, minutes: Schema.Number })

const longest = 24 * 60

const refuse = (status: Refusal["status"], message: string): Effect.Effect<never, Refusal> =>
  Effect.fail(new Refusal({ status, body: { message } }))

/** The operator asking, the service, and how to reach its environment's cluster, or why not. */
const asked = (environment: string, name: string) =>
  Effect.gen(function* () {
    const person = yield* withRole
    if (person.role !== "operator") return yield* refuse(403, "switching debug is for operators")
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const found = catalog.environments.find((each) => each.name === environment)
    const service = catalog.services.find((each) => each.name === name && each.environments.includes(environment))
    if (found === undefined || service === undefined) return yield* refuse(404, `${name} is not in ${environment}`)
    if (service.debug === undefined) return yield* refuse(404, `the catalog names no log level for ${name}`)
    const kubernetes = settings.sources[found.sources]?.kubernetes
    if (kubernetes === undefined) return yield* refuse(404, `${environment} has no cluster to switch it in`)
    const cluster = yield* clusterOf(kubernetes).pipe(
      Effect.mapError((failure) => new Refusal({ status: 502, body: { message: failure.message } })),
    )
    const prefix = kubernetes.impersonationPrefix ?? ""
    const acting =
      kubernetes.impersonate === true
        ? { name: `${prefix}${person.name}`, groups: person.groups.map((group) => `${prefix}${group}`) }
        : undefined
    return { person, service, cluster, acting }
  })

const failed = (failure: { readonly message: string }) => json({ message: failure.message }, 502)

export const debugOnRoute = HttpRouter.add(
  "POST",
  "/api/debug",
  Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(Asked).pipe(
      Effect.mapError(
        () => new Refusal({ status: 400, body: { message: "debug is an environment, a service and minutes" } }),
      ),
    )
    if (!(body.minutes >= 1 && body.minutes <= longest)) return yield* refuse(400, "debug lasts a minute to a day")
    const { person, service, cluster, acting } = yield* asked(body.environment, body.service)
    const now = yield* Clock.currentTimeMillis
    const switched = yield* Effect.result(switchOn(cluster, service, body.minutes, person.name, now, acting))
    if (switched._tag === "Failure") return failed(switched.failure)
    yield* showDebug(body.environment, service.name, switched.success)
    return json(switched.success, 201)
  }).pipe(Effect.catchTag("Refusal", refused)),
)

export const debugOffRoute = HttpRouter.add("DELETE", "/api/debug/:service", () =>
  Effect.gen(function* () {
    const { service: name = "" } = yield* HttpRouter.params
    const { env: environment = "" } = yield* searchParams(EnvParam, "env names an environment")
    const { service, cluster, acting } = yield* asked(environment, name)
    const switched = yield* Effect.result(switchOff(cluster, service, acting))
    if (switched._tag === "Failure") return failed(switched.failure)
    yield* showDebug(environment, service.name, switched.success)
    return json(switched.success, 200)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
