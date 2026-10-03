import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { seal } from "../auth/session"
import { ask, type Server, secret, serverFor, settings } from "../fixture"

const anonymous = settings({ anonymous: { name: "visitor", role: "viewer" } })
const oidc = settings({
  oidc: { issuer: "https://id.example", clientId: "estate", clientSecret: "s", publicUrl: "https://estate.example" },
})

const sessionFor = (name: string, groups: ReadonlyArray<string>, expires = Date.now() + 60_000, key = secret) =>
  seal({ name, groups }, expires, key).pipe(Effect.map((sealed) => ({ cookie: `estate_session=${sealed}` })))

const get = (server: Server, path: string, headers: Record<string, string> = {}) =>
  Effect.promise(() => server.handler(new Request(`http://estate${path}`, { headers })))

/** The first `count` messages of an event stream. */
const firstMessages = (response: Response, count: number): Effect.Effect<ReadonlyArray<string>> =>
  Effect.promise(() => {
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    const read = (text: string): Promise<string> =>
      reader === undefined || text.split("\n\n").length > count
        ? Promise.resolve(text)
        : reader.read().then(({ value, done }) => (done ? text : read(text + decoder.decode(value))))
    return read("").then((text) => reader?.cancel().then(() => text) ?? text)
  }).pipe(Effect.map((text) => text.split("\n\n").slice(0, count)))

const dataOf = (message: string | undefined) => JSON.parse(/data: (.*)/.exec(message ?? "")?.[1] ?? "{}")

describe("who is asking", () => {
  test("without sign-in, everyone is the anonymous person", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answered = yield* ask(yield* serverFor(anonymous), new Request("http://estate/api/me"))
        expect(answered.status).toBe(200)
        expect(answered.json()).toEqual({ name: "visitor", role: "viewer", environments: ["staging", "production"] })
      }),
    ))

  test("with sign-in, nobody signed in is asked to sign in", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answered = yield* ask(yield* serverFor(oidc), new Request("http://estate/api/me"))
        expect(answered.status).toBe(401)
        expect(answered.json()).toEqual({ signIn: "/auth/login" })
      }),
    ))

  test("someone in no role sees who may, and nothing else", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const headers = yield* sessionFor("eve", ["visitors"])
        const server = yield* serverFor(oidc)
        const me = yield* ask(server, new Request("http://estate/api/me", { headers }))
        expect(me.status).toBe(403)
        expect(me.json()).toEqual({ name: "eve", groups: ["developers", "ops"] })
        expect((yield* get(server, "/events?env=staging", headers)).status).toBe(403)
      }),
    ))

  test("a group names the role, operator over viewer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(oidc)
        const viewer = yield* ask(
          server,
          new Request("http://estate/api/me", { headers: yield* sessionFor("ada", ["developers"]) }),
        )
        expect(viewer.json()).toMatchObject({ name: "ada", role: "viewer" })
        const operator = yield* ask(
          server,
          new Request("http://estate/api/me", { headers: yield* sessionFor("gil", ["developers", "ops"]) }),
        )
        expect(operator.json()).toMatchObject({ name: "gil", role: "operator" })
      }),
    ))

  test("a session that has expired, or was sealed with another secret, is nobody", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(oidc)
        expect((yield* get(server, "/api/me", yield* sessionFor("ada", ["ops"], Date.now() - 1))).status).toBe(401)
        expect(
          (yield* get(
            server,
            "/api/me",
            yield* sessionFor("ada", ["ops"], Date.now() + 60_000, "another-secret-of-at-least-32-characters"),
          )).status,
        ).toBe(401)
        expect((yield* get(server, "/api/me", { cookie: "estate_session=nonsense" })).status).toBe(401)
      }),
    ))
})

describe("the event stream", () => {
  test("sends every part of the page for the environment asked for", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* get(yield* serverFor(anonymous), "/events?env=production")
        expect(response.headers.get("content-type")).toBe("text/event-stream")
        const messages = yield* firstMessages(response, 6)
        expect(messages[0]).toBe("retry: 3000")
        expect(messages.slice(1).map((message) => /event: (\w+)/.exec(message)?.[1])).toEqual([
          "catalog",
          "services",
          "alerts",
          "deploys",
          "feed",
        ])
        expect(dataOf(messages[1]).services.map((service: { name: string }) => service.name)).toEqual([
          "storefront",
          "orders",
          "payments",
          "search",
        ])
      }),
    ))

  test("switching environment changes what is listed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const messages = yield* firstMessages(yield* get(yield* serverFor(anonymous), "/events?env=staging"), 2)
        expect(dataOf(messages[1]).services.map((service: { name: string }) => service.name)).toEqual([
          "storefront",
          "orders",
          "search",
        ])
      }),
    ))

  test("an environment not in the catalog is not found", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* get(yield* serverFor(anonymous), "/events?env=qa")).status).toBe(404)
      }),
    ))

  test("without an environment, the catalog's first is sent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const messages = yield* firstMessages(yield* get(yield* serverFor(anonymous), "/events"), 2)
        expect(messages[1]).toContain('"environment":"staging"')
      }),
    ))
})

describe("the pages", () => {
  test("every path that is not the API is the page", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(anonymous)
        for (const path of ["/", "/deploys", "/services/orders"]) {
          const answered = yield* ask(server, new Request(`http://estate${path}`))
          expect(answered.headers.get("content-type")).toContain("text/html")
          expect(answered.text).toContain("<title>Estate</title>")
        }
      }),
    ))

  test("its assets are served, and a missing one is not found", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(anonymous)
        const asset = yield* ask(server, new Request("http://estate/assets/main.js"))
        expect(asset.headers.get("content-type")).toBe("text/javascript")
        expect(asset.text).toBe("run()")
        expect((yield* get(server, "/assets/gone.js")).status).toBe(404)
      }),
    ))

  test("health answers without sign-in", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* ask(yield* serverFor(oidc), new Request("http://estate/healthz"))).text).toBe("ok")
      }),
    ))
})
