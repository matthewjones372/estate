/** One trace as its page draws it: lanes, and its spans and the waits between them in time order (spec 0046). */
import { Schema } from "effect"
import type { Journey } from "./catalog-journey"
import { found, Lane, type Lanes, measure, stageText, type Trace, type TraceSpan, titleOf } from "./traces"

const optional = Schema.optionalKey
const Instant = Schema.String

const Row = Schema.Struct({
  title: Schema.String,
  /** The span's name and kind, or the spans a gap lies between. */
  text: Schema.String,
  lane: Schema.Number,
  from: Schema.Number,
  to: Schema.Number,
  /** A call is a span with spans below it, work one without, a wait the time between two spans. */
  kind: Schema.Literals(["call", "work", "wait"]),
  depth: Schema.Number,
  /** How many of the spans above it are in its own lane, so a call inside another is drawn inside it. */
  nested: Schema.Number,
  failed: Schema.Boolean,
  /** The lane of the span that started it, where that is another: the trace moved from there to here. */
  handedFrom: optional(Schema.Number),
})
export type Row = typeof Row.Type

/** `GET /api/traces/:id`: one trace as lanes and rows in time order, measured from its start. */
export const TraceView = Schema.Struct({
  id: Schema.String,
  startedAt: Instant,
  journey: optional(Schema.Struct({ name: Schema.String, title: Schema.String })),
  answered: optional(Schema.Number),
  total: Schema.Number,
  lanes: Schema.Array(Lane),
  rows: Schema.Array(Row),
  /** A wait longer than half the trace, drawn short so the spans either side of it can be read. */
  cut: optional(Schema.Struct({ from: Schema.Number, to: Schema.Number })),
})
export type TraceView = typeof TraceView.Type

const depthOf = (byId: ReadonlyMap<string, TraceSpan>, span: TraceSpan): number => {
  let depth = 0
  for (let at = span.parent; at !== undefined && depth < 64; at = byId.get(at)?.parent) {
    if (!byId.has(at)) break
    depth += 1
  }
  return depth
}

export const traceView = (trace: Trace, lanes: Lanes, journey?: Journey): TraceView => {
  const measured = journey === undefined ? undefined : measure(journey, trace)
  const first = journey === undefined ? undefined : found(trace, journey.start.span, journey.start.service)
  // A journey's stages are measured from its first span; any other trace from its earliest.
  const origin = first?.start ?? Math.min(...trace.spans.map((span) => span.start))
  const byId = new Map(trace.spans.map((span) => [span.id, span]))
  const parents = new Set(trace.spans.flatMap((span) => (span.parent === undefined ? [] : [span.parent])))
  const named = (journey?.stages ?? []).filter((stage) => stage.span !== undefined)
  const stageOf = (span: TraceSpan) =>
    named.find((stage) => stage.span === span.name && (stage.service === undefined || stage.service === span.service))
  const laneOf = (span: TraceSpan): Lane => {
    const stage = stageOf(span)
    return stage === undefined ? lanes.service(span.service) : lanes.where(stage.where)
  }
  const order: Lane[] = []
  const indexOf = (lane: Lane): number => {
    const at = order.findIndex((each) => each.id === lane.id)
    if (at >= 0) return at
    order.push(lane)
    return order.length - 1
  }
  const nestedOf = (span: TraceSpan): number => {
    const lane = laneOf(span).id
    let nested = 0
    for (let at = span.parent; at !== undefined && nested < 64; at = byId.get(at)?.parent) {
      const above = byId.get(at)
      if (above === undefined) break
      if (laneOf(above).id === lane) nested += 1
    }
    return nested
  }
  const spanRows = [...trace.spans]
    .sort((one, other) => one.start - other.start)
    .map((span) => ({ span, lane: laneOf(span) }))
  const gapRows = (journey?.stages ?? []).flatMap((stage, index) => {
    const took = measured?.stages[index]
    return stage.span !== undefined || took === undefined ? [] : [{ stage, took, lane: lanes.where(stage.where) }]
  })
  const unordered = [
    ...spanRows.map(({ span, lane }) => {
      const parent = span.parent === undefined ? undefined : byId.get(span.parent)
      const parentLane = parent === undefined ? undefined : laneOf(parent)
      return {
        lane,
        parentLane: parentLane !== undefined && parentLane.id !== lane.id ? parentLane : undefined,
        row: {
          title: stageOf(span)?.title ?? span.name,
          text: `${span.name} · ${span.kind}`,
          from: span.start - origin,
          to: span.end - origin,
          kind: parents.has(span.id) ? "call" : "work",
          depth: depthOf(byId, span),
          nested: nestedOf(span),
          failed: span.failed,
        } as const,
      }
    }),
    ...gapRows.map(({ stage, took, lane }) => ({
      lane,
      parentLane: undefined,
      row: {
        title: stage.title,
        text: `gap · ${stageText(stage)}`,
        from: took.from,
        to: took.to,
        kind: "wait",
        depth: 0,
        nested: 0,
        failed: false,
      } as const,
    })),
  ].sort((one, other) => one.row.from - other.row.from || one.row.depth - other.row.depth)
  const rows = unordered.map(({ lane, parentLane, row }) => {
    const handedFrom = parentLane === undefined ? undefined : indexOf(parentLane)
    return { ...row, lane: indexOf(lane), ...(handedFrom === undefined ? {} : { handedFrom }) }
  })
  const total = Math.max(measured?.total ?? 0, ...trace.spans.map((span) => span.end - origin))
  const longest = rows
    .filter((row) => row.kind === "wait")
    .reduce<Row | undefined>(
      (most, row) => (most === undefined || row.to - row.from > most.to - most.from ? row : most),
      undefined,
    )
  return {
    id: trace.id,
    startedAt: new Date(origin).toISOString(),
    ...(journey === undefined || measured === undefined
      ? {}
      : { journey: { name: journey.name, title: titleOf(journey) }, answered: measured.answered }),
    total,
    lanes: order,
    rows,
    ...(longest !== undefined && longest.to - longest.from > total / 2
      ? { cut: { from: longest.from, to: longest.to } }
      : {}),
  }
}

/**
 * Where a time falls across the page's width, as a share of it: in proportion, or with the cut drawn as a tenth of
 * the width and the time either side of it sharing the rest in proportion.
 */
export const placeOf =
  (total: number, cut?: { readonly from: number; readonly to: number }) =>
  (at: number): number => {
    if (total <= 0) return 0
    if (cut === undefined) return Math.min(100, Math.max(0, (100 * at) / total))
    const outside = Math.max(total - (cut.to - cut.from), 1e-9)
    if (at <= cut.from) return (90 * at) / outside
    if (at <= cut.to) return (90 * cut.from) / outside + (10 * (at - cut.from)) / Math.max(cut.to - cut.from, 1e-9)
    return Math.min(100, (90 * cut.from) / outside + 10 + (90 * (at - cut.to)) / outside)
  }
