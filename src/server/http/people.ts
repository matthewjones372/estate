/** Who is asking: the person in the sealed session cookie, or the anonymous person when Estate runs without sign-in. */
import { Clock, Effect, Option, Redacted, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { type Role, roleOf } from "../auth/roles"
import { unseal } from "../auth/session"
import { type AuthSettings, Configured } from "../settings"

export const sessionCookie = "estate_session"
export const attemptCookie = "estate_sign_in"

/** How Estate sets its cookies: `Secure` whenever its public URL is https, so no browser sends them over http. */
export const cookieOptions = (auth: AuthSettings, seconds: number) =>
  ({
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: `${seconds} seconds`,
    secure: auth.oidc?.publicUrl.startsWith("https://") === true,
  }) as const

/** `returnTo` when it is a path on this host, or `/`: never another site, nor `//host` or `/\\host`, which browsers take as one. */
export const pathOnThisHost = (returnTo: string | undefined): string =>
  returnTo?.startsWith("/") === true && !returnTo.startsWith("//") && !returnTo.startsWith("/\\") ? returnTo : "/"

export interface Person {
  readonly name: string
  readonly groups: ReadonlyArray<string>
  readonly role: Role | undefined
  /** A screen signed in with the kiosk token: it reads as a viewer does, and writes nothing. */
  readonly kiosk?: boolean
}

const Sealed = Schema.Struct({
  name: Schema.String,
  groups: Schema.Array(Schema.String),
  kiosk: Schema.optionalKey(Schema.Boolean),
})
const decodeSealed = Schema.decodeUnknownOption(Sealed)

/** The person asking, or none if nobody has signed in. */
export const personAsking: Effect.Effect<
  Option.Option<Person>,
  never,
  HttpServerRequest.HttpServerRequest | Configured
> = Effect.gen(function* () {
  const { auth } = yield* Configured
  if (auth.oidc === undefined && auth.anonymous !== undefined) {
    return Option.some({ name: auth.anonymous.name, groups: [], role: auth.anonymous.role })
  }
  const request = yield* HttpServerRequest.HttpServerRequest
  const cookie = request.cookies[sessionCookie]
  if (cookie === undefined) return Option.none()
  const now = yield* Clock.currentTimeMillis
  const opened = yield* unseal(cookie, Redacted.value(auth.sessionSecret), now)
  return Option.flatMap(opened, decodeSealed).pipe(
    Option.map(
      (sealed): Person =>
        sealed.kiosk === true
          ? { name: sealed.name, groups: [], role: "viewer", kiosk: true }
          : { name: sealed.name, groups: sealed.groups, role: roleOf(sealed.groups, auth.roles) },
    ),
  )
})
