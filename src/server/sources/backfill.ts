/**
 * Alerts' firings from before Estate kept them, as Prometheus's own `ALERTS` series has them: a run of points is a
 * firing, a gap ends it. Read once as Estate starts, so a card says what happened before, if without notes.
 */
import { Clock, Duration, Effect, Schema, SubscriptionRef } from "effect"
import type { Service } from "../../shared/catalog"
import { Notes } from "../notes"
import { callJson, type Remote } from "../remote"
import type { Settings } from "../settings"
import { Estate, type StoredFiring, updateEstate } from "../state"
import { before, iso } from "../time"
import { serviceOf } from "../views/health"
import { alertId } from "./alerts"
import { prometheusOf, type Reach } from "./grafana"
import { type Failure, SourceFailure } from "./run"

const Matrix = Schema.Struct({
  data: Schema.Struct({
    result: Schema.Array(
      Schema.Struct({
        metric: Schema.Record(Schema.String, Schema.String),
        values: Schema.Array(Schema.Tuple([Schema.Number, Schema.String])),
      }),
    ),
  }),
})

/** Five minutes a point keeps thirty days under Prometheus's 11,000 points a series. */
const step = 300
const days = 30

/** Each run of points in a series, as a firing; one still running is left to the firings Estate records. */
export const firingsIn = (
  matrix: typeof Matrix.Type,
  environment: string,
  services: ReadonlyArray<Service>,
  end: number,
): ReadonlyArray<StoredFiring> =>
  matrix.data.result.flatMap(({ metric, values }) => {
    const { __name__: _, alertstate: __, ...labels } = metric
    const service = serviceOf(labels, services)
    const runs: Array<{ start: number; last: number }> = []
    for (const [at] of values) {
      const run = runs.at(-1)
      if (run !== undefined && at - run.last <= step * 1.5) run.last = at
      else runs.push({ start: at, last: at })
    }
    return runs
      .filter((run) => run.last < end - step)
      .map((run) => ({
        environment,
        alert: alertId(labels),
        name: labels["alertname"] ?? "unnamed",
        ...(service === undefined ? {} : { service }),
        startsAt: iso(run.start * 1000),
        endsAt: iso((run.last + step) * 1000),
      }))
  })

const pastFirings = (
  prometheus: Reach,
  environment: string,
  services: ReadonlyArray<Service>,
  now: number,
): Effect.Effect<ReadonlyArray<StoredFiring>, Failure, Remote> => {
  const end = Math.floor(now / 1000 / step) * step
  const parameters = new URLSearchParams({
    query: 'ALERTS{alertstate="firing"}',
    start: String(end - days * 86_400),
    end: String(end),
    step: String(step),
  })
  return callJson({ url: `${prometheus.url}/api/v1/query_range?${parameters}`, headers: prometheus.headers }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Matrix)),
    Effect.map((matrix) => firingsIn(matrix, environment, services, end)),
    Effect.mapError((error) => new SourceFailure({ message: `Prometheus's ALERTS ${error.message}` })),
  )
}

/** Whether a firing read from Prometheus is one Estate already kept: the same alert, overlapping in time. */
const known = (kept: ReadonlyArray<StoredFiring>, firing: StoredFiring) =>
  kept.some(
    (each) =>
      each.environment === firing.environment &&
      each.alert === firing.alert &&
      each.startsAt <= (firing.endsAt ?? firing.startsAt) &&
      (each.endsAt ?? "9999") >= firing.startsAt,
  )

/** Every environment's earlier firings from its Prometheus, kept beside those Estate recorded; a failure is logged. */
export const backfillHistory = <R = never>(
  settings: Settings,
  /** One environment's, or else every environment's. */
  only?: string,
  shown: (fresh: ReadonlyArray<StoredFiring>) => Effect.Effect<void, never, R | Estate> = (fresh) =>
    updateEstate((estate) => ({ ...estate, firings: [...(estate.firings ?? []), ...fresh] })),
) =>
  Effect.gen(function* () {
    const { catalog, firings = [] } = yield* SubscriptionRef.get(yield* Estate)
    const notes = yield* Notes
    const now = yield* Clock.currentTimeMillis
    const since = iso(before(now, Duration.days(days)))
    const read = yield* Effect.forEach(
      catalog.environments.filter((environment) => only === undefined || environment.name === only),
      (environment) => {
        const prometheus = prometheusOf(settings.sources[environment.sources] ?? {})
        return prometheus === undefined
          ? Effect.succeed([])
          : pastFirings(prometheus, environment.name, catalog.services, now).pipe(
              Effect.catch((failure) =>
                Effect.as(Effect.logWarning(`earlier firings could not be read: ${failure.message}`), []),
              ),
            )
      },
      { concurrency: 4 },
    )
    const fresh = read.flat().filter((firing) => firing.startsAt >= since && !known(firings, firing))
    yield* Effect.forEach(fresh, (firing) => notes.keepFiring(firing), { discard: true }).pipe(
      Effect.catch((failure) => Effect.logWarning(`earlier firings could not be kept: ${failure.message}`)),
    )
    if (fresh.length > 0) yield* shown(fresh)
  })
