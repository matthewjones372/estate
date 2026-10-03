/**
 * A service's logs: `GET /logs?env=&service=`, its lines as an event stream, and `GET /api/logs/errors`, its errors
 * over a range grouped by message. For viewers, unless `auth.logs` keeps them to operators.
 */
import { Clock, Duration, Effect, Schema, Stream } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import type { ErrorGroups } from "../../shared/log-events"
import { LogHub, serviceLogs } from "../log-hub"
import { Configured } from "../settings"
import { groupErrors } from "../sources/lines"
import { json, Refusal, refused, searchParams, withRole } from "./routes"

/** The person asking, if they may read logs here. */
const reader = Effect.gen(function* () {
  const person = yield* withRole
  const { auth } = yield* Configured
  if (auth.logs === "operator" && person.role !== "operator")
    return yield* new Refusal({ status: 403, body: { message: "logs are for operators here" } })
  return person
})

const Asked = Schema.Struct({ env: Schema.String, service: Schema.String })

const heartbeat = Duration.seconds(15)

export const logsRoute = HttpRouter.add(
  "GET",
  "/logs",
  Effect.gen(function* () {
    yield* reader
    const { env, service } = yield* searchParams(Asked, "logs are asked for by env and service")
    const logs = yield* serviceLogs(env, service)
    if (logs === undefined) return json({ message: `${service} has no logs to read in ${env}` }, 404)
    const hub = yield* LogHub
    const batches = Stream.unwrap(hub.watch(env, service)).pipe(
      Stream.map((batch) => `event: lines\ndata: ${JSON.stringify(batch)}\n\n`),
    )
    const body = Stream.make(`retry: 3000\nevent: from\ndata: ${JSON.stringify(logs.from)}\n\n`).pipe(
      Stream.concat(Stream.merge(batches, Stream.tick(heartbeat).pipe(Stream.map(() => ": still here\n\n")))),
      Stream.encodeText,
    )
    return HttpServerResponse.stream(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    })
  }).pipe(Effect.catchTag("Refusal", refused)),
)

const ranges = { "1h": Duration.hours(1), "6h": Duration.hours(6), "24h": Duration.hours(24) } as const

const ErrorsAsked = Schema.Struct({
  env: Schema.String,
  service: Schema.String,
  range: Schema.optionalKey(Schema.Literals(["1h", "6h", "24h"])),
  since: Schema.optionalKey(Schema.String),
})

const most = 2000

export const errorsRoute = HttpRouter.add(
  "GET",
  "/api/logs/errors",
  Effect.gen(function* () {
    yield* reader
    const asked = yield* searchParams(
      ErrorsAsked,
      "errors are asked for by env, service, and a range of 1h, 6h or 24h or a since time",
    )
    const logs = yield* serviceLogs(asked.env, asked.service)
    if (logs === undefined) return json({ message: `${asked.service} has no logs to read in ${asked.env}` }, 404)
    const now = yield* Clock.currentTimeMillis
    const since = asked.since === undefined ? Number.NaN : Date.parse(asked.since)
    const from = Number.isNaN(since) ? now - Duration.toMillis(ranges[asked.range ?? "1h"]) : since
    const read = yield* Effect.result(logs.read(from, now, most))
    if (read._tag === "Failure") return json({ message: read.failure.message }, 502)
    const body: ErrorGroups = { from: logs.from, groups: groupErrors(read.success, logs.isError) }
    return json(body)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
