/**
 * A service's logs: `GET /logs?env=&service=`, its lines as an event stream, and `GET /api/logs/errors`, its errors
 * over a range grouped by message. For viewers, unless `auth.logs` keeps them to operators.
 */
import { Clock, Duration, Effect, Schema, Stream } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import type { ErrorGroups } from "../../shared/log-events"
import { errorsMost, LogHub, serviceLogs } from "../log-hub"
import { Configured } from "../settings"
import { groupErrors } from "../sources/lines"
import { heartbeat } from "../stream"
import { json, Refusal, refused, searchParams, writer } from "./routes"

/** The person asking, if they may read logs here. */
const reader = Effect.gen(function* () {
  const person = yield* writer
  const { auth } = yield* Configured
  if (auth.logs === "operator" && person.role !== "operator")
    return yield* new Refusal({ status: 403, body: { message: "logs are for operators here" } })
  return person
})

const Asked = Schema.Struct({ env: Schema.String, service: Schema.String })

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
  /** The end of a window in the past, such as a firing's; now when not said. */
  until: Schema.optionalKey(Schema.String),
})

/** A window's errors: a range up to now shared through the hub, a window with a start or an end read for itself. */
const errorsIn = (asked: typeof ErrorsAsked.Type) =>
  Effect.gen(function* () {
    if (asked.since === undefined && asked.until === undefined)
      return yield* (yield* LogHub).errorsOver(asked.env, asked.service, ranges[asked.range ?? "1h"])
    const logs = yield* serviceLogs(asked.env, asked.service)
    if (logs === undefined) return undefined
    const now = yield* Clock.currentTimeMillis
    const since = asked.since === undefined ? Number.NaN : Date.parse(asked.since)
    const from = Number.isNaN(since) ? now - Duration.toMillis(ranges[asked.range ?? "1h"]) : since
    const until = asked.until === undefined ? Number.NaN : Date.parse(asked.until)
    return { logs, read: yield* logs.errors(from, Number.isNaN(until) ? now : Math.min(until, now), errorsMost) }
  })

export const errorsRoute = HttpRouter.add(
  "GET",
  "/api/logs/errors",
  Effect.gen(function* () {
    yield* reader
    const asked = yield* searchParams(
      ErrorsAsked,
      "errors are asked for by env, service, and a range of 1h, 6h or 24h or a since time, and an until time",
    )
    const found = yield* Effect.result(errorsIn(asked))
    if (found._tag === "Failure") return json({ message: found.failure.message }, 502)
    if (found.success === undefined)
      return json({ message: `${asked.service} has no logs to read in ${asked.env}` }, 404)
    const { logs, read } = found.success
    const body: ErrorGroups = { from: logs.from, groups: groupErrors(read.lines, logs.isError), capped: read.capped }
    return json(body)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
