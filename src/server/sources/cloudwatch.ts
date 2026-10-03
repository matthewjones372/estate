/**
 * CloudWatch, for an estate on AWS with no Prometheus: its alarms as alerts, read-only (ALARM is firing,
 * INSUFFICIENT_DATA is pending), and GetMetricData as the query over a range, the catalog's queries being CloudWatch's
 * own expressions. An alarm on one metric carries a Metrics Insights expression for its chart and its threshold.
 */
import { Effect, Option, Schema, Stream } from "effect"
import { compact } from "../../shared/compact"
import type { AwsCallError, AwsJson } from "../aws/json"
import type { SourcedAlert } from "../state"
import { iso } from "../time"
import { alertId } from "./alerts"
import { onGrid, type Ranges } from "./prometheus"
import { type Failure, SourceFailure } from "./run"

export const cloudwatchApi = {
  service: "monitoring",
  target: "GraniteServiceVersion20100801",
  version: "1.0",
  name: "CloudWatch",
} as const

const Dimension = Schema.Struct({ Name: Schema.String, Value: Schema.String })
const Alarm = Schema.Struct({
  AlarmName: Schema.String,
  AlarmDescription: Schema.optionalKey(Schema.String),
  StateValue: Schema.String,
  StateUpdatedTimestamp: Schema.optionalKey(Schema.Number),
  Namespace: Schema.optionalKey(Schema.String),
  MetricName: Schema.optionalKey(Schema.String),
  Statistic: Schema.optionalKey(Schema.String),
  Dimensions: Schema.optionalKey(Schema.Array(Dimension)),
  Threshold: Schema.optionalKey(Schema.Number),
  ComparisonOperator: Schema.optionalKey(Schema.String),
})
type Alarm = typeof Alarm.Type
const Alarms = Schema.Struct({
  MetricAlarms: Schema.Array(Alarm),
  NextToken: Schema.optionalKey(Schema.String),
})
const Data = Schema.Struct({
  MetricDataResults: Schema.Array(
    Schema.Struct({ Timestamps: Schema.Array(Schema.Number), Values: Schema.Array(Schema.Number) }),
  ),
})

const ask = <S extends Schema.Decoder<unknown>>(cloudwatch: AwsJson, operation: string, body: object, schema: S) =>
  cloudwatch(operation, body).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(
      (error: AwsCallError | Schema.SchemaError): Failure =>
        new SourceFailure({
          message:
            error._tag === "AwsCallError"
              ? `CloudWatch ${error.message}`
              : `CloudWatch answered ${operation} in a shape Estate does not know`,
        }),
    ),
  )

const statistics: Readonly<Record<string, string>> = {
  Average: "AVG",
  Sum: "SUM",
  Minimum: "MIN",
  Maximum: "MAX",
  SampleCount: "COUNT",
}
const comparisons: Readonly<Record<string, string>> = {
  GreaterThanThreshold: ">",
  GreaterThanOrEqualToThreshold: ">=",
  LessThanThreshold: "<",
  LessThanOrEqualToThreshold: "<=",
}

/** An alarm on one metric as a Metrics Insights query held to its threshold; nothing for metric math or percentiles. */
export const comparisonOf = (alarm: Alarm): string | undefined => {
  const statistic = statistics[alarm.Statistic ?? ""]
  const comparison = comparisons[alarm.ComparisonOperator ?? ""]
  const { Namespace, MetricName, Threshold } = alarm
  if (statistic === undefined || comparison === undefined) return undefined
  if (Namespace === undefined || MetricName === undefined || Threshold === undefined) return undefined
  const dimensions = alarm.Dimensions ?? []
  const schema = [`"${Namespace}"`, ...dimensions.map((dimension) => dimension.Name)].join(", ")
  const where = dimensions.map((dimension) => `${dimension.Name} = '${dimension.Value.replace(/'/g, "''")}'`)
  return `SELECT ${statistic}(${MetricName}) FROM SCHEMA(${schema})${where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`} ${comparison} ${Threshold}`
}

const states: Readonly<Record<string, SourcedAlert["state"]>> = { ALARM: "firing", INSUFFICIENT_DATA: "pending" }

/** An alarm as an alert: labelled by its dimensions, with its ServiceName as the service it is about. */
const alertOf = (alarm: Alarm, state: SourcedAlert["state"]): SourcedAlert => {
  const dimensions = Object.fromEntries((alarm.Dimensions ?? []).map((each) => [each.Name, each.Value]))
  const { ServiceName: service } = dimensions
  const labels = { alertname: alarm.AlarmName, ...dimensions, ...(service === undefined ? {} : { service }) }
  return compact({
    id: alertId(labels),
    name: alarm.AlarmName,
    state,
    severity: "warning",
    summary: alarm.AlarmDescription,
    startsAt: iso((alarm.StateUpdatedTimestamp ?? 0) * 1000),
    labels,
    expression: comparisonOf(alarm),
  })
}

/** Every metric alarm in ALARM or INSUFFICIENT_DATA, page by page. */
export const readAlarms = (cloudwatch: AwsJson): Effect.Effect<ReadonlyArray<SourcedAlert>, Failure> =>
  Stream.paginate(undefined as string | undefined, (from) =>
    ask(
      cloudwatch,
      "DescribeAlarms",
      { AlarmTypes: ["MetricAlarm"], MaxRecords: 100, ...(from === undefined ? {} : { NextToken: from }) },
      Alarms,
    ).pipe(
      Effect.map((page) => {
        const alerts = page.MetricAlarms.flatMap((alarm) => {
          const state = states[alarm.StateValue]
          return state === undefined ? [] : [alertOf(alarm, state)]
        })
        return [alerts, Option.fromUndefinedOr(page.NextToken)] as const
      }),
    ),
  ).pipe(Stream.runCollect)

/** GetMetricData as the query over a range: the catalog's query is CloudWatch's expression, a point a step. */
export const cloudwatchRanges = (cloudwatch: AwsJson): Ranges => ({
  range: (query, span, now) => {
    const end = Math.floor(now / 1000 / span.step) * span.step
    const start = end - span.seconds
    return ask(
      cloudwatch,
      "GetMetricData",
      {
        MetricDataQueries: [{ Id: "estate", Expression: query, Period: span.step, ReturnData: true }],
        StartTime: start,
        EndTime: end + span.step,
        ScanBy: "TimestampAscending",
      },
      Data,
    ).pipe(
      Effect.map((data) => {
        const result = data.MetricDataResults[0]
        const values = (result?.Timestamps ?? []).map(
          (at, index) => [at, String(result?.Values[index] ?? Number.NaN)] as const,
        )
        return onGrid(values, start, span)
      }),
    )
  },
  rules: Effect.succeed(new Map()),
})
