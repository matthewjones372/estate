/** Traces as Estate reads them from the tracing tool, and a catalog's journey measured in them (spec 0046). */
import { Schema } from "effect"
import type { Edge, Journey, Stage } from "./catalog-journey"

const optional = Schema.optionalKey
const Instant = Schema.String

export const TraceSpan = Schema.Struct({
  id: Schema.String,
  parent: optional(Schema.String),
  /** The service its resource names, as OpenTelemetry's `service.name`. */
  service: Schema.String,
  name: Schema.String,
  kind: Schema.Literals(["server", "client", "producer", "consumer", "internal"]),
  /** Milliseconds since the epoch, with their fraction. */
  start: Schema.Number,
  end: Schema.Number,
  failed: Schema.Boolean,
})
export type TraceSpan = typeof TraceSpan.Type

export interface Trace {
  readonly id: string
  readonly spans: ReadonlyArray<TraceSpan>
}

/** How long a trace took, from its first span's start to its last span's end, in milliseconds. */
export const tookOf = (trace: Pick<Trace, "spans">): number =>
  Math.max(...trace.spans.map((span) => span.end)) - Math.min(...trace.spans.map((span) => span.start))

/** Where a stage or span is drawn: a node of the map, a service or a store, by its id and the title the page shows. */
export const Lane = Schema.Struct({ id: Schema.String, title: Schema.String })
export type Lane = typeof Lane.Type

/** How the catalog's names become lanes: a stage's `where`, and a span's service where no stage names it. */
export interface Lanes {
  readonly where: (where: string) => Lane
  readonly service: (service: string) => Lane
}

/** A stage's place in one trace, in milliseconds from the start of the journey's first span. */
interface Took {
  readonly from: number
  readonly to: number
}

export interface Measured {
  readonly id: string
  readonly startedAt: string
  /** When the journey's first span ended: its caller had an answer. */
  readonly answered: number
  /** When its last stage found ended, or its answer where that is later. */
  readonly total: number
  readonly failed: boolean
  /** Each stage in the journey's order; undefined where the trace does not hold it. */
  readonly stages: ReadonlyArray<Took | undefined>
}

/** The first span of this name, from this service where one is named. */
export const found = (trace: Trace, name: string, service?: string): TraceSpan | undefined =>
  trace.spans
    .filter((span) => span.name === name && (service === undefined || span.service === service))
    .reduce<TraceSpan | undefined>(
      (first, span) => (first === undefined || span.start < first.start ? span : first),
      undefined,
    )

const edgeName = (edge: Edge): string => ("start" in edge ? edge.start : edge.end)

const edgeAt = (trace: Trace, edge: Edge, service: string | undefined): number | undefined => {
  const span = found(trace, edgeName(edge), edge.service ?? service)
  if (span === undefined) return undefined
  return "start" in edge ? span.start : span.end
}

const tookIn = (trace: Trace, stage: Stage, origin: number): Took | undefined => {
  if (stage.span !== undefined) {
    const span = found(trace, stage.span, stage.service)
    return span === undefined ? undefined : { from: span.start - origin, to: span.end - origin }
  }
  if (stage.from === undefined || stage.to === undefined) return undefined
  const from = edgeAt(trace, stage.from, stage.service)
  const to = edgeAt(trace, stage.to, stage.service)
  return from === undefined || to === undefined ? undefined : { from: from - origin, to: Math.max(to, from) - origin }
}

/** The trace measured as the journey: undefined where it does not hold the journey's first span. */
export const measure = (journey: Journey, trace: Trace): Measured | undefined => {
  const first = found(trace, journey.start.span, journey.start.service)
  if (first === undefined) return undefined
  const stages = journey.stages.map((stage) => tookIn(trace, stage, first.start))
  const answered = first.end - first.start
  return {
    id: trace.id,
    startedAt: new Date(first.start).toISOString(),
    answered,
    total: stages.reduce((latest, took) => Math.max(latest, took?.to ?? 0), answered),
    failed: trace.spans.some((span) => span.failed),
    stages,
  }
}

/** The stage as its trace shows it: the span, or the two spans it lies between. */
export const stageText = (stage: Stage): string =>
  stage.span ??
  (stage.from === undefined || stage.to === undefined ? "" : `${edgeName(stage.from)} ··· ${edgeName(stage.to)}`)

/** The value `share` of the way up the sorted values, by nearest rank. */
export const percentile = (values: ReadonlyArray<number>, share: number): number | undefined => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((one, other) => one - other)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))]
}

const Spread = Schema.Struct({ p50: optional(Schema.Number), p99: optional(Schema.Number) })

const spreadOf = (values: ReadonlyArray<number>) => {
  const [p50, p99] = [percentile(values, 0.5), percentile(values, 0.99)]
  return { ...(p50 === undefined ? {} : { p50 }), ...(p99 === undefined ? {} : { p99 }) }
}

const Example = Schema.Struct({
  why: Schema.Literals(["slowest", "failed", "typical", "fastest"]),
  id: Schema.String,
  startedAt: Instant,
  total: Schema.Number,
  answered: Schema.Number,
  failed: Schema.Boolean,
})
type Example = typeof Example.Type

/** `GET /api/journeys`: a journey's stages over a sample of recent traces. */
export const JourneySample = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  minutes: Schema.Number,
  sampled: Schema.Number,
  stages: Schema.Array(
    Schema.Struct({
      title: Schema.String,
      where: Lane,
      text: Schema.String,
      kind: Schema.Literals(["span", "gap"]),
      /** In how many of the sampled traces it was found. */
      found: Schema.Number,
      ...Spread.fields,
    }),
  ),
  answered: Spread,
  total: Spread,
  examples: Schema.Array(Example),
})
export type JourneySample = typeof JourneySample.Type

export const titleOf = (journey: Journey) => journey.title ?? journey.name

/** The slowest, the slowest that failed, the one nearest the middle, and the fastest, each once. */
const examplesOf = (measured: ReadonlyArray<Measured>): ReadonlyArray<Example> => {
  const byTotal = [...measured].sort((one, other) => other.total - one.total)
  const fine = byTotal.filter((each) => !each.failed)
  const middle = percentile(
    fine.map((each) => each.total),
    0.5,
  )
  const picked: Array<readonly [Example["why"], Measured | undefined]> = [
    ["slowest", fine[0]],
    ["failed", byTotal.find((each) => each.failed)],
    ["typical", fine.find((each) => each.total === middle)],
    ["fastest", fine.at(-1)],
  ]
  const seen = new Set<string>()
  return picked.flatMap(([why, each]) => {
    if (each === undefined || seen.has(each.id)) return []
    seen.add(each.id)
    const { id, startedAt, total, answered, failed } = each
    return [{ why, id, startedAt, total, answered, failed }]
  })
}

export const sampleOf = (
  journey: Journey,
  lanes: Lanes,
  traces: ReadonlyArray<Trace>,
  minutes: number,
): JourneySample => {
  const measured = traces.flatMap((trace) => measure(journey, trace) ?? [])
  return {
    name: journey.name,
    title: titleOf(journey),
    minutes,
    sampled: measured.length,
    stages: journey.stages.map((stage, index) => {
      const took = measured.flatMap((each) => {
        const stageTook = each.stages[index]
        return stageTook === undefined ? [] : [stageTook.to - stageTook.from]
      })
      return {
        title: stage.title,
        where: lanes.where(stage.where),
        text: stageText(stage),
        kind: stage.span === undefined ? ("gap" as const) : ("span" as const),
        found: took.length,
        ...spreadOf(took),
      }
    }),
    answered: spreadOf(measured.map((each) => each.answered)),
    total: spreadOf(measured.map((each) => each.total)),
    examples: examplesOf(measured),
  }
}

/** A journey as the catalog event carries it: the services whose pages show it. */
export const DescribedJourney = Schema.Struct({
  name: Schema.String,
  title: Schema.String,
  services: Schema.Array(Schema.String),
  /** The map's nodes it passes through, in order, and its stages at each. */
  places: Schema.Array(Schema.Struct({ node: Schema.String, stages: Schema.Array(Schema.Number) })),
})
