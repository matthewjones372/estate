/**
 * Sign-in with any OIDC provider: the authorization code flow with PKCE, the ID token verified against the provider's
 * keys, and the person's name and groups read from its claims.
 */
import { Cache, Context, Data, Effect, Exit, Layer, Redacted, Schema } from "effect"
import { createLocalJWKSet, type JSONWebKeySet, jwtVerify } from "jose"
import { callJson, type Remote, type RemoteError } from "../remote"
import type { AuthSettings } from "../settings"

export type OidcSettings = NonNullable<AuthSettings["oidc"]>

export const SignInError = Data.TaggedError("SignInError")<{ readonly message: string }>
export type SignInError = InstanceType<typeof SignInError>

const Discovery = Schema.Struct({
  issuer: Schema.String,
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  jwks_uri: Schema.String,
})
type Discovery = typeof Discovery.Type

const decodeDiscovery = Schema.decodeUnknownEffect(Discovery)
const decodeTokens = Schema.decodeUnknownEffect(Schema.Struct({ id_token: Schema.String }))

const failed = (message: string) => () => new SignInError({ message })

const fetchDiscovery = (issuer: string): Effect.Effect<Discovery, SignInError | RemoteError, Remote> =>
  callJson({ url: `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration` }).pipe(
    Effect.flatMap(decodeDiscovery),
    Effect.mapError((error) =>
      error._tag === "RemoteError"
        ? error
        : new SignInError({ message: "the provider's discovery document is not OIDC" }),
    ),
  )

/**
 * What a provider publishes about itself, its discovery document and its signing keys, remembered for an hour, so a
 * sign-in does not fetch them every time; a failure to fetch is not remembered.
 */
export interface Provider {
  readonly discover: (oidc: OidcSettings) => Effect.Effect<Discovery, SignInError | RemoteError, Remote>
  readonly keys: (url: string) => Effect.Effect<unknown, RemoteError, Remote>
}
export const Provider = Context.Service<Provider>("estate/Provider")

const forAnHour = (exit: Exit.Exit<unknown, unknown>) => (Exit.isSuccess(exit) ? "1 hour" : 0)

export const providerLayer = Layer.effect(Provider)(
  Effect.gen(function* () {
    const discoveries = yield* Cache.makeWith(fetchDiscovery, {
      capacity: 4,
      timeToLive: forAnHour,
      requireServicesAt: "lookup",
    })
    const keySets = yield* Cache.makeWith((url: string) => callJson({ url }), {
      capacity: 4,
      timeToLive: forAnHour,
      requireServicesAt: "lookup",
    })
    return {
      discover: (oidc: OidcSettings) => Cache.get(discoveries, oidc.issuer),
      keys: (url: string) => Cache.get(keySets, url),
    }
  }),
)

/** The provider's discovery document, as remembered. */
export const discover = (oidc: OidcSettings): Effect.Effect<Discovery, SignInError | RemoteError, Remote | Provider> =>
  Effect.gen(function* () {
    const provider = yield* Provider
    return yield* provider.discover(oidc)
  })

const callbackUrl = (oidc: OidcSettings): string => `${oidc.publicUrl.replace(/\/$/, "")}/auth/callback`

const random = (bytes: number): string =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url")

export interface Attempt {
  readonly state: string
  readonly verifier: string
  readonly nonce: string
  readonly returnTo: string
}

export const newAttempt = (returnTo: string): Attempt => ({
  state: random(16),
  verifier: random(32),
  nonce: random(16),
  returnTo: returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/",
})

const challenge = (verifier: string): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).pipe(
    Effect.map((digest) => Buffer.from(digest).toString("base64url")),
  )

/** Where to send the browser to sign in. */
export const authorizationUrl = (oidc: OidcSettings, discovery: Discovery, attempt: Attempt): Effect.Effect<string> =>
  challenge(attempt.verifier).pipe(
    Effect.map((codeChallenge) => {
      const url = new URL(discovery.authorization_endpoint)
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: oidc.clientId,
        redirect_uri: callbackUrl(oidc),
        scope: (oidc.scopes ?? ["openid", "profile", "email", "groups"]).join(" "),
        state: attempt.state,
        nonce: attempt.nonce,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
      }).toString()
      return url.toString()
    }),
  )

export interface Person {
  readonly name: string
  readonly groups: ReadonlyArray<string>
}

const claimName = (claims: Readonly<Record<string, unknown>>, oidc: OidcSettings): string | undefined => {
  for (const claim of [oidc.nameClaim ?? "preferred_username", "email", "sub"]) {
    const value = claims[claim]
    if (typeof value === "string" && value !== "") return value
  }
  return undefined
}

const claimGroups = (claims: Readonly<Record<string, unknown>>, oidc: OidcSettings): ReadonlyArray<string> => {
  const value = claims[oidc.groupsClaim ?? "groups"]
  return Array.isArray(value) ? value.filter((group): group is string => typeof group === "string") : []
}

/** The person signing in, from the code the provider sent back. */
export const completeSignIn = (
  oidc: OidcSettings,
  attempt: Attempt,
  code: string,
): Effect.Effect<Person, SignInError | RemoteError, Remote | Provider> =>
  Effect.gen(function* () {
    const discovery = yield* discover(oidc)
    const tokens = yield* callJson({
      url: discovery.token_endpoint,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: callbackUrl(oidc),
        client_id: oidc.clientId,
        client_secret: Redacted.value(oidc.clientSecret),
        code_verifier: attempt.verifier,
      }).toString(),
    }).pipe(Effect.flatMap(decodeTokens), Effect.mapError(failed("the provider sent no ID token")))
    const keys = yield* (yield* Provider).keys(discovery.jwks_uri)
    const verified = yield* Effect.tryPromise({
      try: () =>
        jwtVerify(tokens.id_token, createLocalJWKSet(keys as JSONWebKeySet), {
          issuer: discovery.issuer,
          audience: oidc.clientId,
        }),
      catch: (error) => new SignInError({ message: `the ID token is not valid: ${String(error)}` }),
    })
    const claims = verified.payload
    const { nonce } = claims
    if (nonce !== attempt.nonce) return yield* new SignInError({ message: "the ID token is for another sign-in" })
    const name = claimName(claims, oidc)
    if (name === undefined) return yield* new SignInError({ message: "the ID token names nobody" })
    return { name, groups: claimGroups(claims, oidc) }
  })
