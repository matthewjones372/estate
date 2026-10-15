/**
 * An incident's charts kept as evidence (spec 0047): each of its services' Load and stats, and each store's stats,
 * over its window, with the query each came from, read once from the metrics and kept as a set of its own.
 */
import { Effect, SubscriptionRef } from "effect"
import type { Catalog } from "../shared/catalog"
import type { KeptChart } from "../shared/evidence"
import type { Incident } from "../shared/incidents"
import { statsOf } from "../shared/stats"
import { storeStatsOf } from "../shared/stores"
import { windowOf } from "../shared/window"
import { happenedOnIncident } from "./happened"
import { Notes } from "./notes"
import { environmentsOf } from "./rebuilt"
import { Configured } from "./settings"
import { leadMinutes } from "./settings-incidents"
import { loadOf, storeLoadOf } from "./sources/metrics"
import type { Ranges, Span } from "./sources/prometheus"
import { rangesIn } from "./sources/ranges"
import { Estate } from "./state"
import { isoNow } from "./time"
import { incidentServices, incidentWindow } from "./views/incident-scope"

const loadKinds = ["requests", "errors", "p99"] as const

/** The charts of one service or store in one environment, each with its query. */
const chartsOf = (catalog: Catalog, ranges: Ranges, name: string, environment: string, span: Span, end: number) => {
  const service = catalog.services.find((each) => each.name === name)
  if (service !== undefined)
    return Effect.map(
      loadOf(ranges, service, span, end),
      (load): ReadonlyArray<KeptChart> => [
        ...loadKinds.flatMap((panel) => {
          const [query, series] = [service.load?.[panel], load[panel]]
          return query === undefined || series === undefined
            ? []
            : [{ service: name, environment, panel, query, points: series.points }]
        }),
        // A service's stats come back in the order it names them.
        ...statsOf(service).flatMap((stat, index) => {
          const series = load.stats?.[index]?.series
          const unit = stat.unit === undefined ? {} : { unit: stat.unit }
          return series === undefined
            ? []
            : [{ service: name, environment, panel: stat.title, ...unit, query: stat.query, points: series.points }]
        }),
      ],
    )
  const store = catalog.stores?.find((each) => each.name === name && each.environments.includes(environment))
  if (store === undefined) return Effect.succeed([])
  const queries = new Map(storeStatsOf(store).map((stat) => [stat.key, stat.query]))
  return Effect.map(
    storeLoadOf(ranges, store, span, end),
    (readings): ReadonlyArray<KeptChart> =>
      readings.map((reading) => ({
        service: name,
        environment,
        panel: reading.title,
        ...(reading.unit === undefined ? {} : { unit: reading.unit }),
        query: queries.get(reading.key) ?? "",
        points: reading.series.points,
      })),
  )
}

const many = (count: number, one: string, more: string) => `${count} ${count === 1 ? one : more}`

/** Its charts over its window, read now and kept as a new set, by `by`; the set kept, or none when none was read. */
export const keepEvidence = (incident: Incident, by: string) =>
  Effect.gen(function* () {
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const keptAt = yield* isoNow
    const { from, to } = incidentWindow(incident, leadMinutes(settings.incidents), keptAt)
    const window = windowOf(Date.parse(from), Date.parse(to))
    const span = { seconds: window.end - window.start, step: window.step }
    const services = incidentServices(estate, incident)
    const charts = yield* Effect.forEach(environmentsOf(incident), (environment) =>
      Effect.gen(function* () {
        const where = estate.catalog.environments.find((each) => each.name === environment)
        const ranges = where === undefined ? undefined : yield* rangesIn(settings.sources[where.sources] ?? {})
        if (ranges === undefined) return []
        const each = yield* Effect.forEach(services, (name) =>
          chartsOf(estate.catalog, ranges, name, environment, span, window.end * 1000),
        )
        return each.flat()
      }),
    )
    const set = { id: crypto.randomUUID(), keptAt, keptBy: by, window, charts: charts.flat() }
    if (set.charts.length === 0) return undefined
    yield* (yield* Notes).keepEvidence(incident.id, set)
    const kept = new Set(set.charts.map((chart) => chart.service)).size
    const said = `kept ${many(kept, "service's", "services'")} charts, ${many(set.charts.length, "series", "series")}`
    yield* happenedOnIncident(incident.id, by, "evidence-kept", said)
    return set
  })
