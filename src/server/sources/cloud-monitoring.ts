/**
 * Cloud Monitoring, for an estate on GCP: alert policies as alerts, and Google Cloud Managed Service for Prometheus
 * providing Prometheus HTTP API queries over ranges for vitals, load and charts.
 */
import { Effect, Schema } from "effect"
import { compact } from "../../shared/compact"
import type { GcpCallError, GcpJson } from "../gcp/json"
import type { SourcedAlert } from "../state"
import { alertId } from "./alerts"
import { Instant, Matrix, onGrid, type Ranges, Rules, subsetOf, Vector } from "./prometheus"
import { type Failure, SourceFailure } from "./run"

const optional = Schema.optionalKey

const Condition = Schema.Struct({
  name: optional(Schema.String),
  displayName: optional(Schema.String),
  conditionThreshold: optional(
    Schema.Struct({
      filter: optional(Schema.String),
      comparison: optional(Schema.String),
      thresholdValue: optional(Schema.Number),
    }),
  ),
})

const AlertPolicy = Schema.Struct({
  name: Schema.String,
  displayName: Schema.String,
  documentation: optional(Schema.Struct({ content: optional(Schema.String) })),
  userLabels: optional(Schema.Record(Schema.String, Schema.String)),
  conditions: optional(Schema.Array(Condition)),
  enabled: optional(Schema.Boolean),
})

const AlertPoliciesList = Schema.Struct({
  alertPolicies: optional(Schema.Array(AlertPolicy)),
})

const gcpFailure = (error: GcpCallError): Failure => new SourceFailure({ message: `Cloud Monitoring ${error.message}` })

const decode =
  <S extends Schema.Decoder<unknown>>(schema: S, operation: string) =>
  (body: unknown): Effect.Effect<S["Type"], Failure> =>
    Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError(
        () => new SourceFailure({ message: `Cloud Monitoring answered ${operation} in an unexpected shape` }),
      ),
    )

const comparisonSymbol = (comparison?: string): string => {
  if (comparison === "COMPARISON_GT") return ">"
  if (comparison === "COMPARISON_GE") return ">="
  if (comparison === "COMPARISON_LT") return "<"
  if (comparison === "COMPARISON_LE") return "<="
  return ">"
}

const expressionOf = (policy: typeof AlertPolicy.Type): string | undefined => {
  const threshold = policy.conditions?.[0]?.conditionThreshold
  if (threshold?.filter === undefined || threshold.thresholdValue === undefined) return undefined
  return `${threshold.filter} ${comparisonSymbol(threshold.comparison)} ${threshold.thresholdValue}`
}

const alertOf = (policy: typeof AlertPolicy.Type): SourcedAlert => {
  const userLabels = policy.userLabels ?? {}
  const service = userLabels["service"] ?? userLabels["service_name"]
  const labels: Record<string, string> = {
    alertname: policy.displayName,
    ...userLabels,
    ...(service !== undefined ? { service } : {}),
  }
  const severity = userLabels["severity"] === "critical" ? "critical" : "warning"
  return compact({
    id: alertId(labels),
    name: policy.displayName,
    state: "firing",
    severity,
    summary: policy.documentation?.content ?? policy.displayName,
    startsAt: new Date(0).toISOString(),
    labels,
    expression: expressionOf(policy),
  })
}

/** Alert policies from Cloud Monitoring mapped to active alerts. */
export const readCloudMonitoringAlerts = (
  gcp: GcpJson,
  project: string,
): Effect.Effect<ReadonlyArray<SourcedAlert>, Failure> => {
  const url = `https://monitoring.googleapis.com/v3/projects/${project}/alertPolicies`
  return gcp({ url }).pipe(
    Effect.mapError(gcpFailure),
    Effect.flatMap(decode(AlertPoliciesList, "alertPolicies")),
    Effect.map((list) => (list.alertPolicies ?? []).filter((policy) => policy.enabled !== false).map(alertOf)),
  )
}

/**
 * Ranges backed by Google Cloud Managed Service for Prometheus, which exposes standard Prometheus HTTP API
 * endpoints (/api/v1/query_range, /api/v1/query) under the project's global prometheus path.
 */
export const cloudMonitoringRanges = (project: string, gcp: GcpJson, endpoint?: string): Ranges => {
  const baseUrl =
    endpoint !== undefined && !endpoint.includes("monitoring.googleapis.com")
      ? endpoint.replace(/\/+$/, "")
      : `https://monitoring.googleapis.com/v1/projects/${project}/location/global/prometheus`
  return {
    range: (query, span, now, labels = {}) => {
      const end = Math.floor(now / 1000 / span.step) * span.step
      const start = end - span.seconds
      const parameters = new URLSearchParams({ query, start: String(start), end: String(end), step: String(span.step) })
      return gcp({ url: `${baseUrl}/api/v1/query_range?${parameters}` }).pipe(
        Effect.mapError(gcpFailure),
        Effect.flatMap(decode(Matrix, "query_range")),
        Effect.map((matrix) => {
          const result = matrix.data.result.find((each) => subsetOf(each.metric, labels)) ?? matrix.data.result[0]
          return onGrid(result?.values ?? [], start, span)
        }),
      )
    },
    instant: (query) => {
      const parameters = new URLSearchParams({ query })
      return gcp({ url: `${baseUrl}/api/v1/query?${parameters}` }).pipe(
        Effect.mapError(gcpFailure),
        Effect.flatMap(decode(Vector, "query")),
        Effect.map((answer) =>
          answer.data.result.flatMap(({ metric, value: [, value] }) =>
            Number.isFinite(Number(value)) ? [{ labels: metric, value: Number(value) }] : [],
          ),
        ),
      )
    },
    labels: (query) => {
      const parameters = new URLSearchParams({ query })
      return gcp({ url: `${baseUrl}/api/v1/query?${parameters}` }).pipe(
        Effect.mapError(gcpFailure),
        Effect.flatMap(decode(Instant, "query")),
        Effect.map((answer) => answer.data.result.map((each) => each.metric)),
      )
    },
    rules: gcp({ url: `${baseUrl}/api/v1/rules` }).pipe(
      Effect.mapError(gcpFailure),
      Effect.flatMap(decode(Rules, "rules")),
      Effect.map(
        (rules) =>
          new Map(
            rules.data.groups.flatMap((group) =>
              group.rules.filter((rule) => rule.type === "alerting").map((rule) => [rule.name, rule.query] as const),
            ),
          ),
      ),
      Effect.orElseSucceed(() => new Map()),
    ),
  }
}
