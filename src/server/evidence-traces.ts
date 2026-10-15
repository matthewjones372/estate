/**
 * An incident's traces kept as evidence (spec 0047): for each journey through one of its services, the ten slowest and
 * the ten failed in its window; then up to twenty more that its kept log lines name. Each read whole from Tempo; a
 * search Tempo does not answer is named.
 */
import { Effect, SubscriptionRef } from "effect"
import type { Catalog } from "../shared/catalog"
import type { KeptLogs, KeptTrace } from "../shared/evidence"
import { type Trace, tookOf } from "../shared/traces"
import { Notes } from "./notes"
import type { Sources } from "./settings"
import { tempoOf } from "./sources/grafana"
import { readTrace, searchTraces, spansNamed } from "./sources/tempo"
import { Estate } from "./state"
import { journeysIn, servicesOf } from "./views/journeys"

const sampled = 50
const each = 10
const named = 20

/** A trace read whole, or none when Tempo does not answer for it. */
const whole = (tempo: NonNullable<ReturnType<typeof tempoOf>>, id: string) =>
  readTrace(tempo, id).pipe(
    Effect.map((trace) => (trace.spans.length === 0 ? [] : [trace])),
    Effect.orElseSucceed(() => []),
  )

export const tracesOf = (
  catalog: Catalog,
  sources: Sources,
  environment: string,
  services: ReadonlyArray<string>,
  window: { readonly from: number; readonly to: number },
  logs: ReadonlyArray<KeptLogs>,
) =>
  Effect.gen(function* () {
    const tempo = tempoOf(sources)
    if (tempo === undefined) return { traces: [], missing: [] }
    const journeys = journeysIn(catalog, environment).filter((journey) =>
      servicesOf(catalog, journey).some((service) => services.includes(service)),
    )
    const sampledOf = yield* Effect.forEach(journeys, (journey) =>
      searchTraces(tempo, spansNamed(journey.start.service, journey.start.span), window, sampled).pipe(
        Effect.flatMap((ids) => Effect.forEach(ids, (id) => whole(tempo, id), { concurrency: 4 })),
        Effect.map((read): ReadonlyArray<KeptTrace> => {
          const slowestFirst = read.flat().toSorted((a, b) => tookOf(b) - tookOf(a))
          const kept = (why: KeptTrace["why"], traces: ReadonlyArray<Trace>) =>
            traces.slice(0, each).map((trace) => ({ ...trace, environment, why, journey: journey.name }))
          const failed = (trace: Trace) => trace.spans.some((span) => span.failed)
          return [
            ...kept(
              "slowest",
              slowestFirst.filter((trace) => !failed(trace)),
            ),
            ...kept("failed", slowestFirst.filter(failed)),
          ]
        }),
        Effect.map((traces) => ({ traces, missing: [] })),
        Effect.catch((failure) =>
          Effect.succeed({
            traces: [],
            missing: [`the traces of journey ${journey.name} in ${environment}: ${failure.message}`],
          }),
        ),
      ),
    )
    const journeyed = [...new Map(sampledOf.flatMap((each) => each.traces).map((trace) => [trace.id, trace])).values()]
    const ids = new Set(journeyed.map((trace) => trace.id))
    const mentioned = [
      ...new Set(
        logs
          .filter((kept) => kept.environment === environment)
          .flatMap((kept) => kept.lines.flatMap((line) => (line.trace === undefined ? [] : [line.trace]))),
      ),
    ]
      .filter((id) => !ids.has(id))
      .slice(0, named)
    const read = yield* Effect.forEach(mentioned, (id) => whole(tempo, id), { concurrency: 4 })
    return {
      traces: [...journeyed, ...read.flat().map((trace): KeptTrace => ({ ...trace, environment, why: "named" }))],
      missing: sampledOf.flatMap((each) => each.missing),
    }
  })

/** A trace an incident kept as evidence, from the newest set that holds it; none where no incident kept it. */
export const keptTrace = (id: string) =>
  Effect.gen(function* () {
    const incidents = (yield* SubscriptionRef.get(yield* Estate)).incidents ?? []
    const notes = yield* Notes
    const sets = yield* Effect.forEach(incidents, (incident) =>
      notes.evidence(incident.id).pipe(Effect.orElseSucceed(() => [])),
    )
    return sets
      .flat()
      .toSorted((a, b) => Date.parse(b.keptAt) - Date.parse(a.keptAt))
      .flatMap((set) => set.traces ?? [])
      .find((trace) => trace.id === id)
  })
