/** Every call Estate makes to another tool, behind one service, so a test answers them from a table. */
import { Context, Data, Duration, Effect, Layer } from "effect"

export interface Call {
  readonly url: string
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE"
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

export const liveRemote = Layer.succeed(Remote)({
  call: (call) =>
    Effect.tryPromise({
      try: (signal) => {
        const init: RequestInit & { tls?: { ca: string } } = {
          method: call.method ?? "GET",
          headers: call.headers ?? {},
          signal,
          ...(call.body === undefined ? {} : { body: call.body }),
          ...(call.ca === undefined ? {} : { tls: { ca: call.ca } }),
        }
        return fetch(call.url, init).then((response) =>
          response
            .text()
            .then((text) => ({ status: response.status, headers: Object.fromEntries(response.headers), text })),
        )
      },
      catch: (error) =>
        new RemoteError({
          url: call.url,
          message: `could not reach ${hostOf(call.url)}: ${error instanceof Error ? error.message : String(error)}`,
        }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: timeout,
        orElse: () => Effect.fail(new RemoteError({ url: call.url, message: "did not answer in 10 s" })),
      }),
    ),
})

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
