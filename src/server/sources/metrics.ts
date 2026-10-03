/**
 * What Prometheus says of an environment: each service's load over the last hour, the vitals, the map's rates, and
 * for each firing alert the measure its rule watches against its threshold. One query that fails leaves its line
 * empty; Prometheus not answering fails the read.
 */
import { Effect } from "effect"
import type { Catalog, Service } from "../../shared/catalog"
import type { Series } from "../../shared/events"
import type { Remote } from "../remote"
import type { Metrics, ServiceLoad, SourcedAlert } from "../state"
import { alertingRules, lastHour, rangeOf, type Span, thresholdOf } from "./prometheus"
import type { Failure } from "./run"

const empty: Series = { now: null, points: [] }

const quietly = (read: Effect.Effect<Series, Failure, Remote>) => read.pipe(Effect.orElseSucceed(() => empty))

const loadKinds = ["requests", "errors", "p99"] as const

/** A service's load over a span: each of its queries that the catalog names. */
export const loadOf = (
  url: string,
  service: Service,
  span: Span,
  now: number,
): Effect.Effect<ServiceLoad, never, Remote> =>
  Effect.forEach(
    loadKinds.flatMap((kind) => {
      const query = service.load?.[kind]
      return query === undefined ? [] : [[kind, query] as const]
    }),
    ([kind, query]) => quietly(rangeOf(url, query, span, now)).pipe(Effect.map((series) => [kind, series] as const)),
    { concurrency: 3 },
  ).pipe(Effect.map((read) => Object.fromEntries(read)))

const ignored = new Set(["alertname", "severity", "alertstate"])

export const readMetrics = (
  url: string,
  catalog: Catalog,
  services: ReadonlyArray<Service>,
  firing: ReadonlyArray<SourcedAlert>,
  now: number,
): Effect.Effect<Metrics, Failure, Remote> =>
  Effect.gen(function* () {
    const rules = yield* alertingRules(url)
    const loads = yield* Effect.forEach(
      services,
      (service) => loadOf(url, service, lastHour, now).pipe(Effect.map((load) => [service.name, load] as const)),
      {
        concurrency: 4,
      },
    )
    const vitals = yield* Effect.forEach(
      catalog.vitals ?? [],
      (vital) => quietly(rangeOf(url, vital.query, lastHour, now)),
      { concurrency: 4 },
    )
    const edges = yield* Effect.forEach(
      catalog.map?.edges ?? [],
      (edge) =>
        edge.rate === undefined
          ? Effect.succeed(null)
          : quietly(rangeOf(url, edge.rate, lastHour, now)).pipe(Effect.map((series) => series.now)),
      { concurrency: 4 },
    )
    const charts = yield* Effect.forEach(
      firing.filter((alert) => alert.state === "firing"),
      (alert) => {
        const watched = thresholdOf(rules.get(alert.name) ?? "")
        if (watched === undefined) return Effect.succeed([])
        const labels = Object.fromEntries(Object.entries(alert.labels).filter(([name]) => !ignored.has(name)))
        return quietly(rangeOf(url, watched.measure, lastHour, now, labels)).pipe(
          Effect.map((series) => [[alert.id, { points: series.points, threshold: watched.threshold }] as const]),
        )
      },
      { concurrency: 4 },
    )
    return { services: Object.fromEntries(loads), vitals, edges, charts: Object.fromEntries(charts.flat()) }
  })
