import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer, Result } from "effect"
import { platform } from "../platform"
import { type Call, Remote, RemoteError, type Reply, reply, stubRemote } from "../remote"
import { GcpCallError, type GcpJson, makeGcpJson } from "./json"

const creds = ConfigProvider.fromUnknown({ GCP_ACCESS_TOKEN: "ya29.test-token" })

const withCaller = <A, E>(
  use: (gcp: GcpJson) => Effect.Effect<A, E>,
  answer: (call: Call) => Reply | undefined,
  endpoint?: string,
) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(makeGcpJson(endpoint), use).pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, creds),
        Effect.provide(Layer.merge(stubRemote(answer), platform)),
      ),
    ),
  )

describe("GCP JSON REST caller", () => {
  test("answers decoded JSON for 200 responses", () => {
    const calls: Call[] = []
    return withCaller(
      (gcp) => gcp({ url: "https://example.com/api" }),
      (call) => {
        calls.push(call)
        return reply({ message: "ok" })
      },
    ).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.success).toEqual({ message: "ok" })
      }
      expect(calls[0]?.headers?.["authorization"]).toBe("Bearer ya29.test-token")
    })
  })

  test("handles empty string 200 responses as empty object", () =>
    withCaller(
      (gcp) => gcp({ url: "https://example.com/api" }),
      () => ({ status: 200, text: "   ", headers: {} }),
    ).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) {
        expect(result.success).toEqual({})
      }
    }))

  test("fails with GcpCallError when 200 body is invalid JSON", () =>
    withCaller(
      (gcp) => gcp({ url: "https://example.com/api" }),
      () => ({ status: 200, text: "not-json", headers: {} }),
    ).then((result) => {
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(GcpCallError)
        expect(result.failure.status).toBe("INTERNAL")
      }
    }))

  test("decodes Google API error envelope on failure", () =>
    withCaller(
      (gcp) => gcp({ url: "https://example.com/api" }),
      () => ({
        status: 404,
        text: JSON.stringify({ error: { code: 404, message: "Resource not found", status: "NOT_FOUND" } }),
        headers: {},
      }),
    ).then((result) => {
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(404)
        expect(result.failure.status).toBe("NOT_FOUND")
        expect(result.failure.message).toBe("Resource not found")
      }
    }))

  test("handles non-JSON error response with HTTP_ERROR status", () =>
    withCaller(
      (gcp) => gcp({ url: "https://example.com/api" }),
      () => ({ status: 502, text: "Bad Gateway", headers: {} }),
    ).then((result) => {
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) {
        expect(result.failure.code).toBe(502)
        expect(result.failure.status).toBe("HTTP_ERROR")
        expect(result.failure.message).toContain("Bad Gateway")
      }
    }))

  test("rewrites relative and absolute URLs when endpoint is configured", () => {
    const calls: Call[] = []
    return withCaller(
      (gcp) =>
        Effect.all([gcp({ url: "/v1/projects" }), gcp({ url: "https://run.googleapis.com/v2/projects/p/locations" })]),
      (call) => {
        calls.push(call)
        return reply({ ok: true })
      },
      "http://localhost:8080/mock",
    ).then((result) => {
      expect(Result.isSuccess(result)).toBe(true)
      expect(calls[0]?.url).toBe("http://localhost:8080/mock/v1/projects")
      expect(calls[1]?.url).toBe("http://localhost:8080/mock/v2/projects/p/locations")
    })
  })

  test("fails with 401 when credentials fail and 503 when remote fails", () => {
    const unauthed = Effect.runPromise(
      Effect.result(
        Effect.flatMap(makeGcpJson(), (gcp) => gcp({ url: "https://example.com/api" })).pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
          Effect.provide(
            Layer.merge(
              stubRemote(() => undefined),
              platform,
            ),
          ),
        ),
      ),
    )
    const unavailable = Effect.runPromise(
      Effect.result(
        Effect.flatMap(makeGcpJson(), (gcp) => gcp({ url: "https://example.com/api" })).pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, creds),
          Effect.provide(
            Layer.merge(
              Layer.succeed(Remote)({
                call: (call) => Effect.fail(new RemoteError({ url: call.url, message: "network down" })),
              }),
              platform,
            ),
          ),
        ),
      ),
    )
    return Promise.all([unauthed, unavailable]).then(([resUnauthed, resUnavail]) => {
      expect(Result.isFailure(resUnauthed)).toBe(true)
      if (Result.isFailure(resUnauthed)) {
        expect(resUnauthed.failure.code).toBe(401)
      }
      expect(Result.isFailure(resUnavail)).toBe(true)
      if (Result.isFailure(resUnavail)) {
        expect(resUnavail.failure.code).toBe(503)
      }
    })
  })
})
