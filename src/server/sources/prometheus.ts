/** Prometheus's HTTP API: a query over a range as a series on an even grid, and the alerting rules' expressions. */
import { Effect, Schema } from "effect"
import type { Series } from "../../shared/events"
import { callJson, type Remote } from "../remote"
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

const Rules = Schema.Struct({
  data: Schema.Struct({
    groups: Schema.Array(
      Schema.Struct({
        rules: Schema.Array(Schema.Struct({ name: Schema.String, query: Schema.String, type: Schema.String })),
      }),
    ),
  }),
})

export interface Span {
  readonly seconds: number
  readonly step: number
}

export const lastHour: Span = { seconds: 3600, step: 60 }

const decoded =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  (body: unknown): Effect.Effect<S["Type"], Failure> =>
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(() => new SourceFailure({ message: "Prometheus answered in a shape Estate does not know" })),
    )

const failure = (error: { readonly message: string }): Failure =>
  new SourceFailure({ message: `Prometheus ${error.message}` })

/** One result's values laid on the grid from `start`, a point a step, null where Prometheus had none. */
export const onGrid = (values: ReadonlyArray<readonly [number, string]>, start: number, span: Span): Series => {
  const count = Math.floor(span.seconds / span.step) + 1
  const points: Array<number | null> = Array.from({ length: count }, () => null)
  for (const [at, value] of values) {
    const index = Math.round((at - start) / span.step)
    const number = Number(value)
    if (index >= 0 && index < count && Number.isFinite(number)) points[index] = number
  }
  return { now: points.at(-1) ?? null, points }
}

const subsetOf = (labels: Readonly<Record<string, string>>, of: Readonly<Record<string, string>>) =>
  Object.entries(labels).every(([name, value]) => of[name] === value)

/** A query over the span ending now: the result whose labels the alert's include, or the first. */
export const rangeOf = (
  url: string,
  query: string,
  span: Span,
  now: number,
  labels: Readonly<Record<string, string>> = {},
): Effect.Effect<Series, Failure, Remote> => {
  const end = Math.floor(now / 1000 / span.step) * span.step
  const start = end - span.seconds
  const parameters = new URLSearchParams({ query, start: String(start), end: String(end), step: String(span.step) })
  return callJson({ url: `${url}/api/v1/query_range?${parameters}` }).pipe(
    Effect.mapError(failure),
    Effect.flatMap(decoded(Matrix)),
    Effect.map((matrix) => {
      const result = matrix.data.result.find((each) => subsetOf(each.metric, labels)) ?? matrix.data.result[0]
      return onGrid(result?.values ?? [], start, span)
    }),
  )
}

/** Each alerting rule's expression, by the alert's name. */
export const alertingRules = (url: string): Effect.Effect<ReadonlyMap<string, string>, Failure, Remote> =>
  callJson({ url: `${url}/api/v1/rules?type=alert` }).pipe(
    Effect.mapError(failure),
    Effect.flatMap(decoded(Rules)),
    Effect.map(
      (rules) =>
        new Map(
          rules.data.groups.flatMap((group) =>
            group.rules.filter((rule) => rule.type === "alerting").map((rule) => [rule.name, rule.query] as const),
          ),
        ),
    ),
  )

/** An alerting rule's measure and the threshold it is held to: `measure > 0.15` is the measure and 0.15. */
export const thresholdOf = (
  expression: string,
): { readonly measure: string; readonly threshold: number } | undefined => {
  const match = /^(.*\S)\s*(?:>=|<=|>|<|==|!=)\s*(-?[0-9.]+(?:e[+-]?[0-9]+)?)\s*$/is.exec(expression.trim())
  const measure = match?.[1]
  const threshold = Number(match?.[2])
  return measure === undefined || !Number.isFinite(threshold) ? undefined : { measure, threshold }
}
