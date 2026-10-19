/**
 * An incident's evidence (spec 0047): what its charts showed, kept as it closed or when an operator kept it, so its page
 * and its export can draw them once the metrics are gone. Each keep is a set of its own, beside the earlier ones.
 */
import { Schema } from "effect"
import { ErrorGroups, LogLine } from "./log-events"
import { loadPanels } from "./stats"
import { TraceSpan } from "./traces"

const optional = Schema.optionalKey

export const KeptChart = Schema.Struct({
  service: Schema.String,
  environment: Schema.String,
  /** requests, errors or p99 for its Load; a stat's title for its stats. */
  panel: Schema.String,
  unit: optional(Schema.String),
  /** The query it came from, so it can be read again where the metrics are still kept. */
  query: Schema.String,
  /** A point a step across the window; null where the source had nothing. */
  points: Schema.Array(Schema.NullOr(Schema.Number)),
})
export type KeptChart = typeof KeptChart.Type

/** Its unit; a Load chart kept before it carried one is in its panel's. */
export const unitOf = (chart: KeptChart): string | undefined =>
  chart.unit ?? loadPanels.find((each) => each.key === chart.panel)?.unit

/** Each point with when it was read, from the window's start a step apart, as Prometheus laid them. */
export const pointsAt = (chart: KeptChart, window: { readonly start: number; readonly step: number }) =>
  chart.points.map((value, index) => ({ at: (window.start + index * window.step) * 1000, value }))

/** Its highest point, with when; none where the source had nothing. */
export const highestOf = (chart: KeptChart, window: { readonly start: number; readonly step: number }) => {
  const read = pointsAt(chart, window).flatMap(({ at, value }) => (value === null ? [] : [{ at, value }]))
  const [first] = read
  return first === undefined ? undefined : read.reduce((a, b) => (b.value > a.value ? b : a), first)
}

export const KeptLogs = Schema.Struct({
  service: Schema.String,
  environment: Schema.String,
  /** Where the lines came from, as the page names it. */
  from: Schema.String,
  /** Its errors over the window, grouped by message. */
  errors: ErrorGroups.fields.groups,
  /** Its lines masked, errors first then those nearest its first firing, up to `incidents.evidence.lines`. */
  lines: Schema.Array(LogLine),
  /** The lines read and not kept, past `incidents.evidence.lines`. */
  leftOut: Schema.Number,
})
export type KeptLogs = typeof KeptLogs.Type

export const KeptTrace = Schema.Struct({
  id: Schema.String,
  environment: Schema.String,
  /** Among its journey's slowest or failed in the window, named by a kept log line, or included by a person. */
  why: Schema.Literals(["slowest", "failed", "named", "included"]),
  journey: optional(Schema.String),
  spans: Schema.Array(TraceSpan),
})
export type KeptTrace = typeof KeptTrace.Type

export const EvidenceSet = Schema.Struct({
  id: Schema.String,
  keptAt: Schema.String,
  keptBy: Schema.String,
  /** The window the charts cover, in seconds since the epoch, and the step between points. */
  window: Schema.Struct({ start: Schema.Number, end: Schema.Number, step: Schema.Number }),
  charts: Schema.Array(KeptChart),
  /** Each service's logs; none for a reader who may not read logs. */
  logs: optional(Schema.Array(KeptLogs)),
  /** Traces, read whole; none for a reader who may not read logs. */
  traces: optional(Schema.Array(KeptTrace)),
  /** What was not kept, past a limit or from a source that did not answer, each said in a line. */
  leftOut: optional(Schema.Array(Schema.String)),
  /** Included by a person from where they found it (spec 0051), one item, rather than kept whole by Estate. */
  from: optional(Schema.Literals(["included"])),
  /** Why it was included, in their words. */
  why: optional(Schema.String),
})
export type EvidenceSet = typeof EvidenceSet.Type

/** The sets Estate kept whole, on close or when an operator kept them, without what people included one at a time. */
export const keptByEstate = (sets: ReadonlyArray<EvidenceSet> | undefined) =>
  (sets ?? []).filter((set) => set.from === undefined)

/** What people included, newest first: shown, and removed since, which an `evidence-removed` event names (spec 0051). */
export const includedIn = (
  sets: ReadonlyArray<EvidenceSet> | undefined,
  events: ReadonlyArray<{ readonly kind: string; readonly link?: string }>,
) => {
  const removed = new Set(events.flatMap((each) => (each.kind === "evidence-removed" ? [each.link ?? ""] : [])))
  const all = (sets ?? [])
    .filter((set) => set.from === "included")
    .toSorted((a, b) => Date.parse(b.keptAt) - Date.parse(a.keptAt))
  return { shown: all.filter((set) => !removed.has(set.id)), removed: all.filter((set) => removed.has(set.id)) }
}
