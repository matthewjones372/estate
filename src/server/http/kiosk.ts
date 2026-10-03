/**
 * `/kiosk`: the page for a screen on the wall. Opened once with `?token=` from the settings, it seals a session for
 * a screen and sends it on to `/kiosk` without the token, so the token is in no later request or log.
 */
import { createHash, timingSafeEqual } from "node:crypto"
import { Clock, Duration, Effect, Redacted } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { seal } from "../auth/session"
import { Configured } from "../settings"
import { after } from "../time"
import { Web } from "../web"
import { sessionCookie } from "./people"

const screenDays = 30

const digest = (text: string) => createHash("sha256").update(text).digest()

/** Whether the token is the settings', compared in the same time whatever it is. */
const matches = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected))

export const kioskRoute = HttpRouter.add("GET", "/kiosk", (request) =>
  Effect.gen(function* () {
    const token = new URL(request.url, "http://estate").searchParams.get("token")
    if (token !== null) {
      const { auth, kiosk } = yield* Configured
      if (kiosk === undefined || !matches(token, Redacted.value(kiosk.token)))
        return HttpServerResponse.text("That is not this Estate's kiosk token.", { status: 403 })
      const now = yield* Clock.currentTimeMillis
      const sealed = yield* seal(
        { name: "kiosk", groups: [], kiosk: true },
        after(now, Duration.days(screenDays)),
        Redacted.value(auth.sessionSecret),
      )
      const team = new URL(request.url, "http://estate").searchParams.get("team")
      return HttpServerResponse.redirect(team === null ? "/kiosk" : `/kiosk?team=${encodeURIComponent(team)}`).pipe(
        HttpServerResponse.setCookieUnsafe(sessionCookie, sealed, {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          maxAge: `${screenDays * 24 * 3600} seconds`,
        }),
      )
    }
    const web = yield* Web
    return HttpServerResponse.text(web.index, {
      contentType: "text/html; charset=utf-8",
      headers: { "cache-control": "no-cache" },
    })
  }),
)
