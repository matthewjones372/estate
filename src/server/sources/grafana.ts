/**
 * Grafana's alerting, read and written as an Alertmanager: Grafana answers Alertmanager's API under its own path to a
 * service account's token. Its rules are not PromQL comparisons but a query, a reduction and a threshold, so each
 * rule's threshold is read from its ruler and put back as `measure > threshold`, as a Prometheus rule reads.
 */
import { Effect, Redacted, Schema } from "effect"
import { callJson, type Remote } from "../remote"
import type { Sources } from "../settings"

/** Where silences are written and firing alerts read: an Alertmanager, or Grafana's. */
export interface Manager {
  readonly name: "Alertmanager" | "Grafana"
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

const trimmed = (url: string) => url.replace(/\/$/, "")

/** Grafana's calls carry its token, when one is set. */
export const grafanaHeaders = (grafana: NonNullable<Sources["grafana"]>): Readonly<Record<string, string>> =>
  grafana.token === undefined ? {} : { authorization: `Bearer ${Redacted.value(grafana.token)}` }

export const managerOf = (sources: Sources): Manager | undefined => {
  if (sources.grafana !== undefined)
    return {
      name: "Grafana",
      url: `${trimmed(sources.grafana.url)}/api/alertmanager/grafana`,
      headers: grafanaHeaders(sources.grafana),
    }
  return sources.alertmanager === undefined
    ? undefined
    : { name: "Alertmanager", url: trimmed(sources.alertmanager.url), headers: {} }
}

const Evaluator = Schema.Struct({ type: Schema.String, params: Schema.Array(Schema.Number) })

const Model = Schema.Struct({
  expr: Schema.optionalKey(Schema.String),
  type: Schema.optionalKey(Schema.String),
  expression: Schema.optionalKey(Schema.String),
  conditions: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        evaluator: Evaluator,
        query: Schema.optionalKey(Schema.Struct({ params: Schema.Array(Schema.String) })),
      }),
    ),
  ),
})

const Rule = Schema.Struct({
  grafana_alert: Schema.Struct({
    title: Schema.String,
    condition: Schema.String,
    data: Schema.Array(Schema.Struct({ refId: Schema.String, model: Model })),
  }),
})

const Ruler = Schema.Record(Schema.String, Schema.Array(Schema.Struct({ rules: Schema.Array(Rule) })))

const comparisons: Readonly<Record<string, string>> = { gt: ">", lt: "<" }

/** A Grafana rule as `measure > threshold`: its condition's evaluator, against the query it reduces. */
export const comparisonOf = (rule: typeof Rule.Type): string | undefined => {
  const { condition, data } = rule.grafana_alert
  const node = (refId: string | undefined) => data.find((each) => each.refId === refId)?.model
  const held = node(condition)
  const first = held?.conditions?.[0]
  const operator = comparisons[first?.evaluator.type ?? ""]
  const threshold = first?.evaluator.params[0]
  // The measure is the query the condition reads, through any reduction or sum on the way.
  const measureOf = (refId: string | undefined, hops: number): string | undefined => {
    const model = hops > data.length ? undefined : node(refId)
    return model === undefined ? undefined : (model.expr ?? measureOf(model.expression, hops + 1))
  }
  const measure = measureOf(held?.type === "classic_conditions" ? first?.query?.params[0] : held?.expression, 0)
  return operator === undefined || threshold === undefined || measure === undefined
    ? undefined
    : `${measure} ${operator} ${threshold}`
}

/** Each Grafana alerting rule by title, as a comparison; nothing when the ruler cannot be read. */
export const grafanaRules = (
  grafana: NonNullable<Sources["grafana"]>,
): Effect.Effect<ReadonlyMap<string, string>, never, Remote> =>
  callJson({ url: `${trimmed(grafana.url)}/api/ruler/grafana/api/v1/rules`, headers: grafanaHeaders(grafana) }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Ruler)),
    Effect.map(
      (folders) =>
        new Map(
          Object.values(folders)
            .flat()
            .flatMap((group) => group.rules)
            .flatMap((rule) => {
              const comparison = comparisonOf(rule)
              return comparison === undefined ? [] : [[rule.grafana_alert.title, comparison] as const]
            }),
        ),
    ),
    Effect.orElseSucceed(() => new Map<string, string>()),
  )
