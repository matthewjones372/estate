/**
 * Where GCP credentials come from: GCP_ACCESS_TOKEN, Application Default Credentials (service account JWT signed with
 * jose, or authorized user refresh token), or the instance metadata server. Cached until five minutes before expiry.
 */
import { Clock, Config, Data, Effect, FileSystem, Option, Redacted, Ref, Schema } from "effect"
import * as jose from "jose"
import { Remote } from "../remote"

const GcpError = Data.TaggedError("GcpError")<{ readonly message: string }>

export interface Token {
  readonly accessToken: Redacted.Redacted<string>
  readonly expiresAt?: number
}

const TokenResponse = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.optionalKey(Schema.Number),
})
const decodeTokenResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(TokenResponse))

const variable = (name: string) => Config.option(Config.String(name))

const fromDirectToken = Effect.gen(function* () {
  const token = yield* variable("GCP_ACCESS_TOKEN")
  if (Option.isNone(token) || token.value.trim() === "") return Option.none<Token>()
  return Option.some<Token>({ accessToken: Redacted.make(token.value.trim()) })
})

const ServiceAccountKey = Schema.Struct({
  type: Schema.Literal("service_account"),
  client_email: Schema.String,
  private_key: Schema.String,
  token_uri: Schema.optionalKey(Schema.String),
})

const AuthorizedUserKey = Schema.Struct({
  type: Schema.optionalKey(Schema.Literal("authorized_user")),
  client_id: Schema.String,
  client_secret: Schema.String,
  refresh_token: Schema.String,
})

const KeyFile = Schema.Union([ServiceAccountKey, AuthorizedUserKey])
const decodeKeyFile = Schema.decodeUnknownEffect(Schema.fromJsonString(KeyFile))

const exchangeJwt = (email: string, privateKey: string, tokenUri: string, nowMillis: number) =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const nowSeconds = Math.floor(nowMillis / 1000)
    const jwt = yield* Effect.tryPromise({
      try: () =>
        jose.importPKCS8(privateKey, "RS256").then((key) =>
          new jose.SignJWT({ scope: "https://www.googleapis.com/auth/cloud-platform.read-only" })
            .setProtectedHeader({ alg: "RS256", typ: "JWT" })
            .setIssuer(email)
            .setSubject(email)
            .setAudience(tokenUri)
            .setIssuedAt(nowSeconds)
            .setExpirationTime(nowSeconds + 3600)
            .sign(key),
        ),
      catch: (cause) => new GcpError({ message: `could not sign service account assertion: ${String(cause)}` }),
    })
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString()
    const answered = yield* remote.call({
      url: tokenUri,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    })
    if (answered.status !== 200)
      return yield* new GcpError({ message: `token exchange refused with status ${answered.status}` })
    const token = yield* decodeTokenResponse(answered.text)
    return {
      accessToken: Redacted.make(token.access_token),
      ...(token.expires_in === undefined ? {} : { expiresAt: nowMillis + token.expires_in * 1000 }),
    }
  })

const exchangeRefresh = (clientId: string, clientSecret: string, refreshToken: string, nowMillis: number) =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString()
    const answered = yield* remote.call({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    })
    if (answered.status !== 200)
      return yield* new GcpError({ message: `oauth2 refresh refused with status ${answered.status}` })
    const token = yield* decodeTokenResponse(answered.text)
    return {
      accessToken: Redacted.make(token.access_token),
      ...(token.expires_in === undefined ? {} : { expiresAt: nowMillis + token.expires_in * 1000 }),
    }
  })

const fromFile = Effect.gen(function* () {
  const filePath = yield* variable("GOOGLE_APPLICATION_CREDENTIALS")
  if (Option.isNone(filePath)) return Option.none<Token>()
  const fs = yield* FileSystem.FileSystem
  const content = yield* fs.readFileString(filePath.value)
  const key = yield* decodeKeyFile(content)
  const now = yield* Clock.currentTimeMillis
  if ("type" in key && key.type === "service_account") {
    const token = yield* exchangeJwt(
      key.client_email,
      key.private_key,
      key.token_uri ?? "https://oauth2.googleapis.com/token",
      now,
    )
    return Option.some(token)
  }
  const token = yield* exchangeRefresh(key.client_id, key.client_secret, key.refresh_token, now)
  return Option.some(token)
})

const metadataUrl = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"

const fromMetadata = Effect.gen(function* () {
  const remote = yield* Remote
  const answered = yield* remote
    .call({ url: metadataUrl, method: "GET", headers: { "Metadata-Flavor": "Google" } })
    .pipe(Effect.timeout("1 second"), Effect.option)
  if (Option.isNone(answered) || answered.value.status !== 200) return Option.none<Token>()
  const token = yield* decodeTokenResponse(answered.value.text)
  const now = yield* Clock.currentTimeMillis
  return Option.some<Token>({
    accessToken: Redacted.make(token.access_token),
    ...(token.expires_in === undefined ? {} : { expiresAt: now + token.expires_in * 1000 }),
  })
})

const sources = [fromDirectToken, fromFile, fromMetadata]

const firstFound = Effect.gen(function* () {
  for (const source of sources) {
    const found = yield* source
    if (Option.isSome(found)) return found.value
  }
  return yield* new GcpError({
    message: "no GCP credentials: set GCP_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS, or run on GCP",
  })
})

const early = 5 * 60_000

/** GCP token resolver cached until five minutes before expiration. */
export const makeGcpCredentials = Effect.gen(function* () {
  const kept = yield* Ref.make(Option.none<Token>())
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const held = yield* Ref.get(kept)
    if (Option.isSome(held) && (held.value.expiresAt ?? Number.POSITIVE_INFINITY) - early > now) return held.value
    const found = yield* firstFound
    yield* Ref.set(kept, Option.some(found))
    return found
  })
})
