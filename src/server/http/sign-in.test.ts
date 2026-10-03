import { beforeAll, describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose"
import { ask, type Server, serverFor, settings } from "../fixture"
import { type Call, reply } from "../remote"
import { cookieOptions, pathOnThisHost } from "./people"

const issuer = "https://id.example"
const configured = settings({
  oidc: { issuer, clientId: "estate", clientSecret: Redacted.make("secret"), publicUrl: "https://estate.example/" },
})

let privateKey: CryptoKey
let publicJwk: JWK

beforeAll(() =>
  generateKeyPair("RS256").then((pair) =>
    exportJWK(pair.publicKey).then((jwk) => {
      privateKey = pair.privateKey
      publicJwk = { ...jwk, kid: "one", alg: "RS256" }
    }),
  ),
)

const idToken = (claims: Record<string, unknown>, audience = "estate") =>
  Effect.promise(() =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "one" })
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey),
  )

/** A provider that hands out `token` for any code, and records what it was sent. */
const provider =
  (token: () => string, calls: Call[] = []) =>
  (call: Call) => {
    calls.push(call)
    if (call.url === `${issuer}/.well-known/openid-configuration`) {
      return reply({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      })
    }
    if (call.url === `${issuer}/jwks`) return reply({ keys: [publicJwk] })
    if (call.url === `${issuer}/token`) return reply({ id_token: token(), access_token: "a" })
    return undefined
  }

const cookiesOf = (headers: Headers): ReadonlyMap<string, string> =>
  new Map(
    headers.getSetCookie().map((cookie) => {
      const [name = "", value = ""] = cookie.split(";")[0]?.split("=") ?? []
      return [name, value] as const
    }),
  )

/** Starts a sign-in, and returns the provider's authorize URL and the attempt cookie. */
const start = (server: Server, returnTo = "/deploys") =>
  ask(server, new Request(`https://estate.example/auth/login?returnTo=${encodeURIComponent(returnTo)}`)).pipe(
    Effect.map((answered) => {
      expect(answered.status).toBe(302)
      return {
        url: new URL(answered.headers.get("location") ?? ""),
        attempt: cookiesOf(answered.headers).get("estate_sign_in") ?? "",
        secure: answered.headers.getSetCookie().every((cookie) => cookie.includes("Secure")),
      }
    }),
  )

const callback = (server: Server, query: string, attempt: string) =>
  ask(
    server,
    new Request(`https://estate.example/auth/callback?${query}`, { headers: { cookie: `estate_sign_in=${attempt}` } }),
  )

describe("signing in with OIDC", () => {
  test("goes to the provider with PKCE, and comes back signed in where it started", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: Call[] = []
        let token = ""
        const server = yield* serverFor(
          configured,
          undefined,
          provider(() => token, calls),
        )
        const { url, attempt } = yield* start(server)
        expect(url.origin + url.pathname).toBe(`${issuer}/authorize`)
        expect(url.searchParams.get("client_id")).toBe("estate")
        expect(url.searchParams.get("redirect_uri")).toBe("https://estate.example/auth/callback")
        expect(url.searchParams.get("code_challenge_method")).toBe("S256")
        token = yield* idToken({
          sub: "1",
          preferred_username: "ada",
          groups: ["ops"],
          nonce: url.searchParams.get("nonce"),
        })
        const back = yield* callback(server, `code=c0de&state=${url.searchParams.get("state")}`, attempt)
        expect(back.status).toBe(302)
        expect(back.headers.get("location")).toBe("/deploys")
        const exchange = calls.find((call) => call.url === `${issuer}/token`)
        expect(new URLSearchParams(exchange?.body).get("code")).toBe("c0de")
        expect(new URLSearchParams(exchange?.body).get("code_verifier")?.length).toBeGreaterThan(40)

        const session = cookiesOf(back.headers).get("estate_session") ?? ""
        const me = yield* ask(
          server,
          new Request("https://estate.example/api/me", { headers: { cookie: `estate_session=${session}` } }),
        )
        expect(me.json()).toMatchObject({ name: "ada", role: "operator" })
      }),
    ))

  test("comes back only to a path on this host, with cookies a browser sends over https alone", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let token = ""
        const server = yield* serverFor(
          configured,
          undefined,
          provider(() => token),
        )
        const { url, attempt, secure } = yield* start(server, "https://evil.example/sign-in")
        token = yield* idToken({ sub: "1", preferred_username: "ada", nonce: url.searchParams.get("nonce") })
        const back = yield* callback(server, `code=c&state=${url.searchParams.get("state")}`, attempt)
        expect(back.headers.get("location")).toBe("/")
        expect(secure).toBe(true)
        expect(back.headers.getSetCookie().find((cookie) => cookie.startsWith("estate_session"))).toContain("Secure")
        expect(
          ["/services/checkout?env=staging", "//evil.example", "/\\evil.example", "evil.example", undefined].map(
            pathOnThisHost,
          ),
        ).toEqual(["/services/checkout?env=staging", "/", "/", "/", "/"])
        const { oidc, ...anonymous } = configured.auth
        expect(
          oidc && cookieOptions({ ...anonymous, oidc: { ...oidc, publicUrl: "http://localhost/" } }, 60).secure,
        ).toBe(false)
        expect(cookieOptions(anonymous, 60).secure).toBe(false)
      }),
    ))

  test("asks the provider for its discovery document once an hour, not at every sign-in", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: Call[] = []
        const server = yield* serverFor(
          configured,
          undefined,
          provider(() => "", calls),
        )
        for (let started = 0; started < 10; started++) yield* start(server)
        const discovered = calls.filter((call) => call.url === `${issuer}/.well-known/openid-configuration`)
        expect(discovered).toHaveLength(1)
      }),
    ))

  test("refuses a callback whose state is not the one it started", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(
          configured,
          undefined,
          provider(() => ""),
        )
        const { attempt } = yield* start(server)
        const back = yield* callback(server, "code=c&state=other", attempt)
        expect(back.status).toBe(400)
        expect(back.text).toContain("this sign-in was not started here")
      }),
    ))

  test("refuses an ID token for another client, or for another sign-in", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        for (const make of [
          (nonce: string) => idToken({ preferred_username: "ada", nonce }, "someone-else"),
          () => idToken({ preferred_username: "ada", nonce: "replayed" }),
          (nonce: string) => idToken({ nonce, sub: "" }),
        ]) {
          let token = ""
          const server = yield* serverFor(
            configured,
            undefined,
            provider(() => token),
          )
          const { url, attempt } = yield* start(server)
          token = yield* make(url.searchParams.get("nonce") ?? "")
          const back = yield* callback(server, `code=c&state=${url.searchParams.get("state")}`, attempt)
          expect(back.status).toBe(400)
          expect(cookiesOf(back.headers).get("estate_session")).toBeUndefined()
        }
      }),
    ))

  test("says so when the provider does not answer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answered = yield* ask(yield* serverFor(configured), new Request("https://estate.example/auth/login"))
        expect(answered.status).toBe(400)
        expect(answered.text).toContain("the provider did not answer")
      }),
    ))

  test("signing out forgets the session", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answered = yield* ask(
          yield* serverFor(configured),
          new Request("https://estate.example/auth/logout", { method: "POST" }),
        )
        expect(answered.status).toBe(303)
        expect(answered.headers.getSetCookie().join()).toContain("estate_session=;")
      }),
    ))

  test("without a provider, signing in goes straight to the page", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const anonymous = settings({ anonymous: { name: "visitor", role: "viewer" } })
        for (const path of ["/auth/login", "/auth/callback"]) {
          const answered = yield* ask(yield* serverFor(anonymous), new Request(`https://estate.example${path}`))
          expect(answered.headers.get("location")).toBe("/")
        }
      }),
    ))
})
