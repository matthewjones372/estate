/**
 * Traces from Tempo: a TraceQL search for the traces in a window, and a trace read whole as OpenTelemetry's JSON.
 * Read when a page asks, not polled, since a sample is many calls (spec 0046).
 */
import { Effect, Schema } from "effect"
import type { Trace, TraceSpan } from "../../shared/traces"
import { callJson, type Remote } from "../remote"
import type { Reach } from "./grafana"
import { type Failure, SourceFailure } from "./run"

const Found = Schema.Struct({
  traces: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Struct({ traceID: Schema.String })))),
})

const Nanos = Schema.Union([Schema.String, Schema.Number])
const Attribute = Schema.Struct({
  key: Schema.String,
  value: Schema.Struct({ stringValue: Schema.optionalKey(Schema.String) }),
})
const OtlpSpan = Schema.Struct({
  spanId: Schema.String,
  parentSpanId: Schema.optionalKey(Schema.String),
  name: Schema.String,
  kind: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
  startTimeUnixNano: Nanos,
  endTimeUnixNano: Nanos,
  status: Schema.optionalKey(Schema.Struct({ code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])) })),
})
const Scope = Schema.Struct({ spans: Schema.optionalKey(Schema.Array(OtlpSpan)) })
const Batch = Schema.Struct({
  resource: Schema.optionalKey(Schema.Struct({ attributes: Schema.optionalKey(Schema.Array(Attribute)) })),
  scopeSpans: Schema.optionalKey(Schema.Array(Scope)),
  /** The name older OpenTelemetry gave scopeSpans. */
  instrumentationLibrarySpans: Schema.optionalKey(Schema.Array(Scope)),
})
/** Tempo's `/api/traces/:id` answers `batches`; its v2 API, and some proxies, `resourceSpans`, inside `trace` or not. */
const Whole = Schema.Union([
  Schema.Struct({ batches: Schema.Array(Batch) }),
  Schema.Struct({ trace: Schema.Struct({ resourceSpans: Schema.Array(Batch) }) }),
  Schema.Struct({ resourceSpans: Schema.Array(Batch) }),
])

const kinds = ["internal", "server", "client", "producer", "consumer"] as const

/** OTLP's kind, as its enum's name or its number; 0, unspecified, reads as internal. */
const kindOf = (kind: string | number | undefined): TraceSpan["kind"] => {
  if (typeof kind === "number") return kinds[kind - 1] ?? "internal"
  const named = kind?.replace(/^SPAN_KIND_/, "").toLowerCase()
  return kinds.find((each) => each === named) ?? "internal"
}

const failedOf = (code: string | number | undefined) => code === 2 || code === "STATUS_CODE_ERROR"

const millis = (nanos: string | number) => Number(nanos) / 1e6

const spansOf = (batches: ReadonlyArray<typeof Batch.Type>): ReadonlyArray<TraceSpan> =>
  batches.flatMap((batch) => {
    const service =
      batch.resource?.attributes?.find((attribute) => attribute.key === "service.name")?.value.stringValue ?? "unknown"
    return [...(batch.scopeSpans ?? []), ...(batch.instrumentationLibrarySpans ?? [])].flatMap((scope) =>
      (scope.spans ?? []).map((span) => ({
        id: span.spanId,
        ...(span.parentSpanId === undefined || span.parentSpanId === "" ? {} : { parent: span.parentSpanId }),
        service,
        name: span.name,
        kind: kindOf(span.kind),
        start: millis(span.startTimeUnixNano),
        end: millis(span.endTimeUnixNano),
        failed: failedOf(span.status?.code),
      })),
    )
  })

const batchesOf = (whole: typeof Whole.Type) =>
  "batches" in whole ? whole.batches : "trace" in whole ? whole.trace.resourceSpans : whole.resourceSpans

const ask = <S extends Schema.Decoder<unknown>>(tempo: Reach, path: string, schema: S) =>
  callJson({ url: `${tempo.url}${path}`, headers: { accept: "application/json", ...tempo.headers } }).pipe(
    Effect.mapError((error): Failure => new SourceFailure({ message: `Tempo ${error.message}` })),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(() => new SourceFailure({ message: "Tempo answered in a shape Estate does not know" })),
      ),
    ),
  )

/** A TraceQL selector for spans of this name from this service. */
export const spansNamed = (service: string, name: string): string =>
  `{ resource.service.name = ${JSON.stringify(service)} && name = ${JSON.stringify(name)} }`

/** The ids of up to `most` traces a TraceQL query finds between two times, in milliseconds since the epoch. */
export const searchTraces = (
  tempo: Reach,
  query: string,
  window: { readonly from: number; readonly to: number },
  most: number,
): Effect.Effect<ReadonlyArray<string>, Failure, Remote> =>
  Effect.map(
    ask(
      tempo,
      `/api/search?${new URLSearchParams({
        q: query,
        start: String(Math.floor(window.from / 1000)),
        end: String(Math.ceil(window.to / 1000)),
        limit: String(most),
      })}`,
      Found,
    ),
    (found) => (found.traces ?? []).map((trace) => trace.traceID),
  )

/** One trace, every span of it. */
export const readTrace = (tempo: Reach, id: string): Effect.Effect<Trace, Failure, Remote> =>
  Effect.map(ask(tempo, `/api/traces/${encodeURIComponent(id)}`, Whole), (whole) => ({
    id,
    spans: spansOf(batchesOf(whole)),
  }))
