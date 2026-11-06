/**
 * GCP JSON REST caller: attaches an OAuth2 Bearer token, prefixes paths with endpoint or default GCP API hosts,
 * and decodes JSON responses or Google API error structures into GcpCallError.
 */
import { Data, Effect, FileSystem, Redacted, Schema } from "effect"
import { Remote } from "../remote"
import { makeGcpCredentials } from "./credentials"

export const GcpCallError = Data.TaggedError("GcpCallError")<{
  readonly code: number
  readonly status: string
  readonly message: string
}>
export type GcpCallError = InstanceType<typeof GcpCallError>

const GoogleErrorEnvelope = Schema.Struct({
  error: Schema.Struct({
    code: Schema.optionalKey(Schema.Number),
    message: Schema.optionalKey(Schema.String),
    status: Schema.optionalKey(Schema.String),
  }),
})
const decodeGoogleError = Schema.decodeUnknownOption(Schema.fromJsonString(GoogleErrorEnvelope))
const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))

interface GcpRequest {
  readonly url: string
  readonly method?: "GET" | "POST" | "PUT" | "DELETE"
  readonly body?: unknown
  readonly headers?: Readonly<Record<string, string>>
}

export type GcpJson = (request: GcpRequest) => Effect.Effect<unknown, GcpCallError>

export const makeGcpJson = (endpoint?: string) =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const fs = yield* FileSystem.FileSystem
    const credentials = (yield* makeGcpCredentials).pipe(
      Effect.provideService(Remote, remote),
      Effect.provideService(FileSystem.FileSystem, fs),
    )

    const call: GcpJson = ({ url, method = "GET", body, headers = {} }) =>
      Effect.gen(function* () {
        const token = yield* credentials.pipe(
          Effect.mapError((err) => new GcpCallError({ code: 401, status: "UNAUTHENTICATED", message: err.message })),
        )

        const fullUrl =
          endpoint !== undefined && !url.startsWith("http")
            ? `${endpoint.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`
            : endpoint !== undefined && url.startsWith("http")
              ? `${endpoint.replace(/\/+$/, "")}${new URL(url).pathname}${new URL(url).search}`
              : url

        const requestHeaders: Record<string, string> = {
          authorization: `Bearer ${Redacted.value(token.accessToken)}`,
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        }

        const answered = yield* remote
          .call({
            url: fullUrl,
            method,
            headers: requestHeaders,
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          })
          .pipe(
            Effect.mapError(
              (error) => new GcpCallError({ code: 503, status: "UNAVAILABLE", message: `GCP ${error.message}` }),
            ),
          )

        if (answered.status >= 200 && answered.status < 300) {
          if (answered.text.trim() === "") return {}
          return yield* decodeAnswer(answered.text).pipe(
            Effect.mapError(
              () =>
                new GcpCallError({
                  code: 500,
                  status: "INTERNAL",
                  message: "GCP answered with invalid JSON",
                }),
            ),
          )
        }

        const refusal = decodeGoogleError(answered.text)
        if (refusal._tag === "Some") {
          const { code = answered.status, message = "GCP request failed", status = "ERROR" } = refusal.value.error
          return yield* new GcpCallError({ code, message, status })
        }

        return yield* new GcpCallError({
          code: answered.status,
          status: "HTTP_ERROR",
          message: `GCP answered status ${answered.status}: ${answered.text}`,
        })
      })

    return call
  })
