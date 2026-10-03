/**
 * What Prometheus says of an environment: each service's load and each store's stats over the last hour, the vitals,
 * the map's rates, and for each firing alert the measure its rule watches against its threshold. One query that fails
 * leaves its line empty; Prometheus not answering fails the read.
 */
import { Effect } from "effect"
import type { Catalog, Service, Store } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Series } from "../../shared/events"
import { statsOf } from "../../shared/stats"
import { storeStatsOf } from "../../shared/stores"
import type { Remote } from "../remote"
import type { Metrics, ServiceLoad, SourcedAlert, StoreReading } from "../state"
import { lastHour, type Ranges, type Span, thresholdOf } from "./prometheus"
import type { Failure } from "./run"

const empty: Series = { now: null, points: [] }

const quietly = (read: Effect.Effect<Series, Failure, Remote>) => read.pipe(Effect.orElseSucceed(() => empty))

const loadKinds = ["requests", "errors", "p99"] as const

/** A service's load over a span: each of its queries that the catalog names, and its stats. */
export const loadOf = (
  ranges: Ranges,
  service: Service,
  span: Span,
  now: number,
): Effect.Effect<ServiceLoad, never, Remote> =>
  Effect.gen(function* () {
    const load = yield* Effect.forEach(
      loadKinds.flatMap((kind) => {
        const query = service.load?.[kind]
        return query === undefined ? [] : [[kind, query] as const]
      }),
      ([kind, query]) => quietly(ranges.range(query, span, now)).pipe(Effect.map((series) => [kind, series] as const)),
      { concurrency: ranges.concurrency ?? 3 },
    )
    const stats = yield* Effect.forEach(
      statsOf(service),
      (stat) =>
        quietly(ranges.range(stat.query, span, now)).pipe(
          Effect.map((series) => compact({ title: stat.title, unit: stat.unit, series })),
        ),
      { concurrency: ranges.concurrency ?? 3 },
    )
    return { ...Object.fromEntries(load), ...(stats.length === 0 ? {} : { stats }) }
  })

/** A store's stats over a span, from the preset for its engine and its own queries. */
export const storeLoadOf = (
  ranges: Ranges,
  store: Store,
  span: Span,
  now: number,
): Effect.Effect<ReadonlyArray<StoreReading>, never, Remote> =>
  Effect.forEach(
    storeStatsOf(store),
    (stat) =>
      quietly(ranges.range(stat.query, span, now)).pipe(
        Effect.map((series) => compact({ key: stat.key, title: stat.title, unit: stat.unit, series })),
      ),
    { concurrency: ranges.concurrency ?? 3 },
  )

// Labels that say where an alert came from, not what it measures: Prometheus's own, and Grafana's.
const ignored = new Set([
  "alertname",
  "severity",
  "alertstate",
  "grafana_folder",
  "__alert_rule_uid__",
  "__alert_rule_namespace_uid__",
  "datasource_uid",
  "ref_id",
])

/** Each firing alert's measure over the last hour against its threshold, by the alert's id. */
export const chartsOf = (
  ranges: Ranges,
  rules: ReadonlyMap<string, string>,
  alerts: ReadonlyArray<SourcedAlert>,
  now: number,
): Effect.Effect<Metrics["charts"], never, Remote> =>
  Effect.forEach(
    alerts.filter((alert) => alert.state === "firing"),
    (alert) => {
      // An alert that carries its own comparison (a CloudWatch alarm's) is charted by it, else by its rule's.
      const watched = thresholdOf(alert.expression ?? rules.get(alert.name) ?? "")
      if (watched === undefined) return Effect.succeed([])
      const labels = Object.fromEntries(Object.entries(alert.labels).filter(([name]) => !ignored.has(name)))
      return quietly(ranges.range(watched.measure, lastHour, now, labels)).pipe(
        Effect.map((series) => [[alert.id, { points: series.points, threshold: watched.threshold }] as const]),
      )
    },
    { concurrency: ranges.concurrency ?? 4 },
  ).pipe(Effect.map((charts) => Object.fromEntries(charts.flat())))

export const readMetrics = (
  ranges: Ranges,
  catalog: Catalog,
  services: ReadonlyArray<Service>,
  stores: ReadonlyArray<Store>,
  firing: ReadonlyArray<SourcedAlert>,
  now: number,
): Effect.Effect<Metrics, Failure, Remote> =>
  Effect.gen(function* () {
    const rules = yield* ranges.rules
    const loads = yield* Effect.forEach(
      services,
      (service) => loadOf(ranges, service, lastHour, now).pipe(Effect.map((load) => [service.name, load] as const)),
      { concurrency: ranges.concurrency ?? 4 },
    )
    const storeLoads = yield* Effect.forEach(
      stores,
      (store) =>
        storeLoadOf(ranges, store, lastHour, now).pipe(Effect.map((readings) => [store.name, readings] as const)),
      { concurrency: ranges.concurrency ?? 4 },
    )
    const vitals = yield* Effect.forEach(
      catalog.vitals ?? [],
      (vital) => quietly(ranges.range(vital.query, lastHour, now)),
      { concurrency: ranges.concurrency ?? 4 },
    )
    const edges = yield* Effect.forEach(
      catalog.map?.edges ?? [],
      (edge) =>
        edge.rate === undefined
          ? Effect.succeed(null)
          : quietly(ranges.range(edge.rate, lastHour, now)).pipe(Effect.map((series) => series.now)),
      { concurrency: ranges.concurrency ?? 4 },
    )
    const charts = yield* chartsOf(ranges, rules, firing, now)
    return {
      services: Object.fromEntries(loads),
      ...(stores.length === 0 ? {} : { stores: Object.fromEntries(storeLoads) }),
      vitals,
      edges,
      charts,
    }
  })
