import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, serverFor, settings } from "../fixture"

const screen = { ...settings(), kiosk: { token: Redacted.make("screen-token"), every: "45s" } }

const send = (method: string, path: string, cookie: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

describe("a screen", () => {
  test("signs in once with the kiosk token, and is sent on without it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(screen)
        const wrong = yield* ask(server, new Request("http://estate/kiosk?token=guess"))
        const right = yield* ask(server, new Request("http://estate/kiosk?token=screen-token&team=payments"))
        const page = yield* ask(server, new Request("http://estate/kiosk"))
        const none = yield* ask(yield* serverFor(settings()), new Request("http://estate/kiosk?token=screen-token"))
        return { wrong, right, page, none }
      }),
    ).then(({ wrong, right, page, none }) => {
      expect(wrong.status).toBe(403)
      expect(none.status).toBe(403)
      expect(right.status).toBe(302)
      expect(right.headers.get("location")).toBe("/kiosk?team=payments")
      expect(right.headers.get("set-cookie")).toMatch(/^estate_session=.*HttpOnly/)
      expect(page.text).toContain("<title>Estate</title>")
    }))

  test("reads as a viewer, is told what to show, and changes nothing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(screen)
        const signed = yield* ask(server, new Request("http://estate/kiosk?token=screen-token"))
        const cookie = (signed.headers.get("set-cookie") ?? "").split(";")[0] ?? ""
        const me = yield* ask(server, send("GET", "/api/me", cookie))
        const writes = yield* Effect.forEach(
          [
            send("POST", "/api/notes", cookie, { environment: "staging", alert: "a1", text: "on it" }),
            send("POST", "/api/silences", cookie, { environment: "staging", alert: "a1", minutes: 60, reason: "x" }),
            send("POST", "/api/debug", cookie, { environment: "staging", service: "storefront", minutes: 15 }),
            send("GET", "/api/logs/errors?env=staging&service=storefront", cookie),
          ],
          (request) => ask(server, request),
        )
        return { me: me.json(), writes: writes.map((answered) => [answered.status, answered.json()]) }
      }),
    ).then(({ me, writes }) => {
      expect(me).toEqual({
        name: "kiosk",
        role: "viewer",
        environments: ["staging", "production"],
        kiosk: true,
        screen: { environments: ["staging", "production"], every: 45 },
      })
      expect(writes).toEqual(
        Array.from({ length: 4 }, () => [403, { message: "a screen changes nothing and reads no lines" }]),
      )
    }))
})
