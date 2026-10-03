/** The sign-in routes: off to the provider, back with a code, and out again. */
import { Clock, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpRouter, type HttpServerRequest, HttpServerResponse } from "effect/http"
import { type Attempt, authorizationUrl, completeSignIn, discover, newAttempt } from "../auth/oidc"
import { seal, unseal } from "../auth/session"
import { Configured } from "../settings"
import { attemptCookie, sessionCookie } from "./people"

const sessionHours = 12
const attemptMinutes = 10

const Attempted = Schema.Struct({
  state: Schema.String,
  verifier: Schema.String,
  nonce: Schema.String,
  returnTo: Schema.String,
})
const decodeAttempt = Schema.decodeUnknownOption(Attempted)

const query = (request: HttpServerRequest.HttpServerRequest, name: string): string | undefined =>
  new URL(request.url, "http://estate").searchParams.get(name) ?? undefined

const cookieOptions = (seconds: number) =>
  ({ httpOnly: true, sameSite: "lax", path: "/", maxAge: `${seconds} seconds` }) as const

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)

const failurePage = (message: string) =>
  HttpServerResponse.text(
    `<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><body style="background:#0B0D12;color:#E9ECF2;font-family:sans-serif;padding:48px"><h1>Sign-in failed</h1><p>${escapeHtml(message)}</p><p><a style="color:#8FB0FF" href="/auth/login">Try again</a></p></body>`,
    { status: 400, contentType: "text/html; charset=utf-8" },
  )

const login = HttpRouter.add("GET", "/auth/login", (request) =>
  Effect.gen(function* () {
    const { auth } = yield* Configured
    const returnTo = query(request, "returnTo") ?? "/"
    if (auth.oidc === undefined) return HttpServerResponse.redirect("/")
    const attempt = newAttempt(returnTo)
    const discovery = yield* discover(auth.oidc)
    const url = yield* authorizationUrl(auth.oidc, discovery, attempt)
    const now = yield* Clock.currentTimeMillis
    const sealed = yield* seal(attempt, now + attemptMinutes * 60_000, Redacted.value(auth.sessionSecret))
    return HttpServerResponse.redirect(url).pipe(
      HttpServerResponse.setCookieUnsafe(attemptCookie, sealed, cookieOptions(attemptMinutes * 60)),
    )
  }).pipe(Effect.catch((error) => Effect.succeed(failurePage(`the provider did not answer: ${error.message}`)))),
)

const callback = HttpRouter.add("GET", "/auth/callback", (request) =>
  Effect.gen(function* () {
    const { auth } = yield* Configured
    if (auth.oidc === undefined) return HttpServerResponse.redirect("/")
    const now = yield* Clock.currentTimeMillis
    const cookie = request.cookies[attemptCookie] ?? ""
    const attempt: Option.Option<Attempt> = Option.flatMap(
      yield* unseal(cookie, Redacted.value(auth.sessionSecret), now),
      decodeAttempt,
    )
    const code = query(request, "code")
    if (Option.isNone(attempt) || attempt.value.state !== query(request, "state") || code === undefined) {
      return failurePage(query(request, "error_description") ?? "this sign-in was not started here, or took too long")
    }
    const person = yield* completeSignIn(auth.oidc, attempt.value, code)
    const sealed = yield* seal(person, now + sessionHours * 3_600_000, Redacted.value(auth.sessionSecret))
    return HttpServerResponse.redirect(attempt.value.returnTo).pipe(
      HttpServerResponse.setCookieUnsafe(sessionCookie, sealed, cookieOptions(sessionHours * 3600)),
      HttpServerResponse.expireCookieUnsafe(attemptCookie, { path: "/" }),
    )
  }).pipe(Effect.catch((error) => Effect.succeed(failurePage(error.message)))),
)

const logout = HttpRouter.add(
  "POST",
  "/auth/logout",
  HttpServerResponse.redirect("/", { status: 303 }).pipe(
    HttpServerResponse.expireCookieUnsafe(sessionCookie, { path: "/" }),
  ),
)

export const signInRoutes = Layer.mergeAll(login, callback, logout)
