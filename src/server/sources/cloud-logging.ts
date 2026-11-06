/**
 * A service's lines from Google Cloud Logging: entries:list over its project, filtered by its Cloud Run service name
 * or catalog filter, each revision/execution name as the line's pod, held to the account's call budget.
 */
import { Clock, Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { cloudRunOf, type Service } from "../../shared/catalog"
import type { GcpCallError, GcpJson } from "../gcp/json"
import { makeGcpJson } from "../gcp/json"
import type { Sources } from "../settings"
import { iso } from "../time"
import { type Line, lineOf } from "./lines"
import { type Failure, SourceFailure } from "./run"

const optional = Schema.optionalKey

export const cloudLoggingOverlap = 10_000
const defaultCallsPerSecond = 4

const LogEntry = Schema.Struct({
  insertId: optional(Schema.String),
  timestamp: Schema.String,
  severity: optional(Schema.String),
  textPayload: optional(Schema.String),
  jsonPayload: optional(Schema.Record(Schema.String, Schema.Unknown)),
  resource: optional(
    Schema.Struct({
      type: optional(Schema.String),
      labels: optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
  labels: optional(Schema.Record(Schema.String, Schema.String)),
  trace: optional(Schema.String),
})

const EntriesListResponse = Schema.Struct({
  entries: optional(Schema.Array(LogEntry)),
  nextPageToken: optional(Schema.String),
})

export interface CloudLoggingBudget {
  readonly take: (project: string, perSecond: number) => Effect.Effect<void>
  readonly backOff: (project: string) => Effect.Effect<void>
}
export const CloudLoggingBudget = Context.Service<CloudLoggingBudget>("estate/CloudLoggingBudget")

const pause = 5_000

export const cloudLoggingBudgetLayer = Layer.effect(CloudLoggingBudget)(
  Effect.gen(function* () {
    const next = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
    return {
      take: (project, perSecond) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const turn = yield* Ref.modify(next, (held) => {
            const at = Math.max(now, held.get(project) ?? 0)
            return [at, new Map(held).set(project, at + 1000 / perSecond)] as const
          })
          if (turn > now) yield* Effect.sleep(turn - now)
        }),
      backOff: (project) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Ref.update(next, (held) => new Map(held).set(project, Math.max(now, held.get(project) ?? 0) + pause)),
        ),
    }
  }),
)

interface Pace {
  readonly take: Effect.Effect<void>
  readonly backOff: Effect.Effect<void>
}

const decode =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (body: unknown): Effect.Effect<S["Type"], Failure> =>
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => new SourceFailure({ message: "Cloud Logging answered in an unexpected shape" })),
    )

const messageOf = (entry: typeof LogEntry.Type): string => {
  if (entry.textPayload !== undefined) return entry.textPayload
  if (entry.jsonPayload !== undefined) {
    const msg = entry.jsonPayload["message"]
    if (typeof msg === "string") return msg
    return JSON.stringify(entry.jsonPayload)
  }
  return ""
}

const podOf = (entry: typeof LogEntry.Type): string | undefined =>
  entry.labels?.["run.googleapis.com/execution_name"] ??
  entry.resource?.labels?.["revision_name"] ??
  entry.labels?.["instanceId"]

const lineFrom = (entry: typeof LogEntry.Type): Line => {
  const text = messageOf(entry)
  const line = lineOf(entry.timestamp, text, podOf(entry))
  if (entry.severity !== undefined) {
    return { ...line, level: entry.severity.toUpperCase() }
  }
  return line
}

export const cloudLoggingLines = (
  gcp: GcpJson,
  project: string,
  filter: string,
  from: number,
  to: number,
  limit: number,
  pace: Pace = { take: Effect.void, backOff: Effect.void },
): Effect.Effect<ReadonlyArray<Line>, Failure> => {
  const timeFilter = `timestamp >= "${iso(from)}" AND timestamp <= "${iso(to)}"`
  const fullFilter = `${filter} AND ${timeFilter}`
  const url = "https://logging.googleapis.com/v2/entries:list"

  return pace.take.pipe(
    Effect.andThen(
      gcp({
        url,
        method: "POST",
        body: {
          resourceNames: [`projects/${project}`],
          filter: fullFilter,
          orderBy: "timestamp desc",
          pageSize: limit,
        },
      }),
    ),
    Effect.flatMap(decode(EntriesListResponse)),
    Effect.catchTag("GcpCallError", (error: GcpCallError) =>
      Effect.andThen(
        error.code === 429 ? pace.backOff : Effect.void,
        new SourceFailure({ message: `Cloud Logging ${error.message}` }),
      ),
    ),
    Effect.map((response) => (response.entries ?? []).map(lineFrom).sort((a, b) => a.at.localeCompare(b.at))),
  )
}

type Gcp = NonNullable<Sources["gcp"]>
type CloudLoggingSettings = NonNullable<Sources["cloudLogging"]>

export const cloudLoggingFilterOf = (service: Service): string | undefined => {
  const named = service.logs?.cloudLogging
  if (named?.filter !== undefined) return named.filter
  const serviceName = named?.service ?? cloudRunOf(service)?.service ?? service.name
  const container = named?.container
  const base = `resource.type="cloud_run_revision" AND resource.labels.service_name="${serviceName}"`
  return container !== undefined ? `${base} AND labels."run.googleapis.com/container_name"="${container}"` : base
}

export const cloudLoggingReader = (
  gcpSettings: Gcp,
  loggingSettings: CloudLoggingSettings,
  service: Service,
  gcpCaller?: GcpJson,
) => {
  const filter = cloudLoggingFilterOf(service)
  if (filter === undefined) return undefined
  let caller = gcpCaller
  const reach = Effect.gen(function* () {
    if (caller !== undefined) return caller
    caller = yield* makeGcpJson(gcpSettings.endpoint)
    return caller
  })

  return (from: number, to: number, limit: number) =>
    Effect.gen(function* () {
      const gcp = yield* reach
      const budget = yield* Effect.serviceOption(CloudLoggingBudget)
      const perSecond = loggingSettings.callsPerSecond ?? defaultCallsPerSecond
      const pace = Option.match(budget, {
        onNone: () => ({ take: Effect.void, backOff: Effect.void }),
        onSome: (shared) => ({
          take: shared.take(gcpSettings.project, perSecond),
          backOff: shared.backOff(gcpSettings.project),
        }),
      })
      return yield* cloudLoggingLines(gcp, gcpSettings.project, filter, from, to, limit, pace)
    })
}
