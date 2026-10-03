/**
 * An agent's recent runs from Langfuse: its newest traces by name, each read whole for what its generations used and
 * whether any failed. Read when someone asks, not polled, since each run is a call of its own.
 */
import { Effect, Redacted, Schema } from "effect"
import type { AgentRun } from "../../shared/agents"
import { compact } from "../../shared/compact"
import { callJson, type Remote } from "../remote"
import type { Sources } from "../settings"
import { type Failure, SourceFailure } from "./run"

type Langfuse = NonNullable<Sources["langfuse"]>

const Traces = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) })

const Usage = Schema.Struct({ total: Schema.optionalKey(Schema.NullOr(Schema.Number)) })
const Trace = Schema.Struct({
  id: Schema.String,
  timestamp: Schema.String,
  htmlPath: Schema.optionalKey(Schema.String),
  latency: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  totalCost: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  observations: Schema.Array(
    Schema.Struct({
      type: Schema.String,
      level: Schema.optionalKey(Schema.String),
      statusMessage: Schema.optionalKey(Schema.NullOr(Schema.String)),
      model: Schema.optionalKey(Schema.NullOr(Schema.String)),
      usage: Schema.optionalKey(Schema.NullOr(Usage)),
    }),
  ),
})

const urlOf = (langfuse: Langfuse) => (langfuse.url ?? "https://cloud.langfuse.com").replace(/\/$/, "")

const ask = <S extends Schema.Decoder<unknown>>(langfuse: Langfuse, path: string, schema: S) =>
  callJson({
    url: `${urlOf(langfuse)}${path}`,
    headers: {
      authorization: `Basic ${btoa(`${Redacted.value(langfuse.publicKey)}:${Redacted.value(langfuse.secretKey)}`)}`,
    },
  }).pipe(
    Effect.mapError((error): Failure => new SourceFailure({ message: `Langfuse ${error.message}` })),
    Effect.flatMap((body) =>
      Schema.decodeUnknownEffect(schema)(body).pipe(
        Effect.mapError(() => new SourceFailure({ message: "Langfuse answered in a shape Estate does not know" })),
      ),
    ),
  )

/** A trace as a run: failed if any of its steps was an error, its tokens the sum of its generations'. */
const runOf = (langfuse: Langfuse, trace: typeof Trace.Type): AgentRun => {
  const error = trace.observations.find((step) => step.level === "ERROR")
  const generations = trace.observations.filter((step) => step.type === "GENERATION")
  const used = generations.flatMap((step) => (typeof step.usage?.total === "number" ? [step.usage.total] : []))
  return compact({
    id: trace.id,
    startedAt: trace.timestamp,
    failed: error !== undefined,
    message: error?.statusMessage ?? undefined,
    seconds: trace.latency ?? undefined,
    tokens: used.length === 0 ? undefined : used.reduce((total, each) => total + each, 0),
    cost: trace.totalCost ?? undefined,
    model: generations.find((step) => typeof step.model === "string")?.model ?? undefined,
    url: trace.htmlPath === undefined ? undefined : `${urlOf(langfuse)}${trace.htmlPath}`,
  })
}

/** The agent's newest runs, newest first. */
export const agentRuns = (
  langfuse: Langfuse,
  name: string,
  most = 10,
): Effect.Effect<ReadonlyArray<AgentRun>, Failure, Remote> =>
  Effect.gen(function* () {
    const listed = yield* ask(
      langfuse,
      `/api/public/traces?${new URLSearchParams({ name, limit: String(most), orderBy: "timestamp.desc" })}`,
      Traces,
    )
    return yield* Effect.forEach(
      listed.data,
      (trace) =>
        Effect.map(ask(langfuse, `/api/public/traces/${encodeURIComponent(trace.id)}`, Trace), (whole) =>
          runOf(langfuse, whole),
        ),
      { concurrency: 4 },
    )
  })
