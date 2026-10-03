/** Who is asking: the person in the sealed session cookie, or the anonymous person when Estate runs without sign-in. */
import { Clock, Effect, Option, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { type Role, roleOf } from "../auth/roles"
import { unseal } from "../auth/session"
import { Configured } from "../settings"

export const sessionCookie = "estate_session"
export const attemptCookie = "estate_sign_in"

export interface Person {
  readonly name: string
  readonly role: Role | undefined
}

const Sealed = Schema.Struct({ name: Schema.String, groups: Schema.Array(Schema.String) })
const decodeSealed = Schema.decodeUnknownOption(Sealed)

/** The person asking, or none if nobody has signed in. */
export const personAsking: Effect.Effect<
  Option.Option<Person>,
  never,
  HttpServerRequest.HttpServerRequest | Configured
> = Effect.gen(function* () {
  const { auth } = yield* Configured
  if (auth.oidc === undefined && auth.anonymous !== undefined) {
    return Option.some({ name: auth.anonymous.name, role: auth.anonymous.role })
  }
  const request = yield* HttpServerRequest.HttpServerRequest
  const cookie = request.cookies[sessionCookie]
  if (cookie === undefined) return Option.none()
  const now = yield* Clock.currentTimeMillis
  const opened = yield* unseal(cookie, auth.sessionSecret, now)
  return Option.flatMap(opened, decodeSealed).pipe(
    Option.map((sealed) => ({ name: sealed.name, role: roleOf(sealed.groups, auth.roles) })),
  )
})
