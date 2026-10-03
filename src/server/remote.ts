/** Every call Estate makes to another tool, behind one service, so a test answers them from a table. */
import { Context, Data, Duration, Effect, Layer, Schedule } from "effect"
import { FetchHttpClient, HttpClient, type HttpClientError, HttpClientRequest } from "effect/http"
import { timeCall } from "./observed"

export interface Call {
  readonly url: string
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  /** A CA to trust beyond the system's, as for a cluster's API server. */
  readonly ca?: string
}

export interface Reply {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly text: string
}

export const RemoteError = Data.TaggedError("RemoteError")<{ readonly url: string; readonly message: string }>
export type RemoteError = InstanceType<typeof RemoteError>

export interface Remote {
  readonly call: (call: Call) => Effect.Effect<Reply, RemoteError>
}
export const Remote = Context.Service<Remote>("estate/Remote")

const timeout = Duration.seconds(10)

const hostOf = (url: string): string => URL.parse(url)?.host ?? url

const requestOf = (call: Call) => {
  const request = HttpClientRequest.make(call.method ?? "GET")(call.url).pipe(
    HttpClientRequest.setHeaders(call.headers ?? {}),
  )
  return call.body === undefined ? request : HttpClientRequest.bodyText(request, call.body)
}

/** Bun's fetch takes `tls`, beyond the standard's options. */
const trusting = (ca: string | undefined): RequestInit => {
  const init: RequestInit & { readonly tls?: { readonly ca: string } } = ca === undefined ? {} : { tls: { ca } }
  return init
}

/** Why a call did not get through, in the words of what refused it. */
const reasonOf = (error: HttpClientError.HttpClientError): string => {
  const cause = error.reason.cause
  return cause instanceof Error ? cause.message : error.message
}

/**
 * Calls through Effect's HTTP client: a read that could not get through is tried twice more, backing off, while a
 * write is tried once; every call is given up on after ten seconds, and a CA, as for a cluster's API server, is
 * trusted beyond the system's for that call alone.
 */
export const liveRemote = Layer.effect(Remote)(
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const reading = client.pipe(
      HttpClient.retryTransient({ retryOn: "errors-only", times: 2, schedule: Schedule.exponential("200 millis") }),
    )
    return {
      call: (call: Call) =>
        timeCall(hostOf(call.url), ((call.method ?? "GET") === "GET" ? reading : client).execute(requestOf(call))).pipe(
          Effect.flatMap((response) =>
            Effect.map(response.text, (text) => ({ status: response.status, headers: { ...response.headers }, text })),
          ),
          Effect.provideService(FetchHttpClient.RequestInit, trusting(call.ca)),
          Effect.mapError(
            (error) =>
              new RemoteError({ url: call.url, message: `could not reach ${hostOf(call.url)}: ${reasonOf(error)}` }),
          ),
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () => Effect.fail(new RemoteError({ url: call.url, message: "did not answer in 10 s" })),
          }),
          Effect.withSpan("upstream", { attributes: { host: hostOf(call.url), method: call.method ?? "GET" } }),
        ),
    }
  }),
).pipe(Layer.provide(FetchHttpClient.layer))

/** A Remote answering from `answer`; a call it has no answer for is a 404, as from a tool without that path. */
export const stubRemote = (answer: (call: Call) => Reply | undefined) =>
  Layer.succeed(Remote)({
    call: (call) => Effect.succeed(answer(call) ?? { status: 404, headers: {}, text: "not found" }),
  })

export const reply = (body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Reply => ({
  status,
  headers,
  text: typeof body === "string" ? body : JSON.stringify(body),
})

/** The body of a call that should answer 2xx with JSON. */
export const callJson = (call: Call): Effect.Effect<unknown, RemoteError, Remote> =>
  Effect.gen(function* () {
    const remote = yield* Remote
    const answered = yield* remote.call(call)
    if (answered.status < 200 || answered.status >= 300) {
      return yield* new RemoteError({
        url: call.url,
        message: `answered ${answered.status}: ${answered.text.slice(0, 200)}`,
      })
    }
    return yield* Effect.try({
      try: () => (answered.text === "" ? null : JSON.parse(answered.text)),
      catch: () => new RemoteError({ url: call.url, message: "answered with something other than JSON" }),
    })
  })
