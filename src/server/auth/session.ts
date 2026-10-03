/** Sealed cookies: a JSON payload with an HMAC beside it, so the server keeps no sessions and trusts what it sealed. */
import { Effect, Option } from "effect"

const encoder = new TextEncoder()

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url")

const key = (secret: string) =>
  Effect.promise(() =>
    crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]),
  )

/** A payload sealed until `expires` (milliseconds since the epoch). */
export const seal = (payload: unknown, expires: number, secret: string): Effect.Effect<string> =>
  Effect.gen(function* () {
    const body = base64url(encoder.encode(JSON.stringify({ payload, expires })))
    const hmac = yield* key(secret)
    const signature = yield* Effect.promise(() => crypto.subtle.sign("HMAC", hmac, encoder.encode(body)))
    return `${body}.${base64url(new Uint8Array(signature))}`
  })

/** The payload, if `sealed` was sealed with `secret` and has not expired. */
export const unseal = (sealed: string, secret: string, now: number): Effect.Effect<Option.Option<unknown>> =>
  Effect.gen(function* () {
    const [body, signature] = sealed.split(".")
    if (body === undefined || signature === undefined) return Option.none()
    const hmac = yield* key(secret)
    const valid = yield* Effect.promise(() =>
      crypto.subtle.verify("HMAC", hmac, Buffer.from(signature, "base64url"), encoder.encode(body)),
    )
    if (!valid) return Option.none()
    const opened: { payload: unknown; expires: number } = JSON.parse(Buffer.from(body, "base64url").toString())
    return opened.expires > now ? Option.some(opened.payload) : Option.none()
  })
