/**
 * AWS Cost Explorer: each entry's month to date and yesterday, by the cost allocation tag that names it, in one grouped
 * call; the month's forecast for entries with a monthly budget; and anomalies on a monitor split by that tag. Cost
 * Explorer charges for each call, so it is read every few hours, not every few seconds.
 */
import { Effect, Schema } from "effect"
import { compact } from "../../shared/compact"
import type { Cost, CostOf } from "../../shared/costs"
import type { AwsCallError, AwsJson } from "../aws/json"
import { type Failure, SourceFailure } from "./run"

export const costExplorerApi = {
  service: "ce",
  target: "AWSInsightsIndexService",
  version: "1.1",
  name: "Cost Explorer",
} as const

/** An entry whose cost is read: its name on the page, the tag value that names it in the bill, and its budget. */
export interface Billed {
  readonly name: string
  readonly cost?: CostOf
}

const Amount = Schema.Struct({ Amount: Schema.String, Unit: Schema.optionalKey(Schema.String) })

const Usage = Schema.Struct({
  ResultsByTime: Schema.Array(
    Schema.Struct({
      TimePeriod: Schema.Struct({ Start: Schema.String }),
      Groups: Schema.Array(
        Schema.Struct({ Keys: Schema.Array(Schema.String), Metrics: Schema.Record(Schema.String, Amount) }),
      ),
    }),
  ),
})

const Forecast = Schema.Struct({ Total: Amount })

const Anomalies = Schema.Struct({
  Anomalies: Schema.Array(
    Schema.Struct({
      AnomalyStartDate: Schema.optionalKey(Schema.String),
      AnomalyEndDate: Schema.optionalKey(Schema.String),
      DimensionValue: Schema.optionalKey(Schema.String),
      RootCauses: Schema.optionalKey(Schema.Array(Schema.Struct({ Service: Schema.optionalKey(Schema.String) }))),
      Impact: Schema.Struct({ MaxImpact: Schema.Number }),
    }),
  ),
})

const ask = <S extends Schema.Decoder<unknown>>(ce: AwsJson, operation: string, body: object, schema: S) =>
  ce(operation, body).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(schema)),
    Effect.mapError(
      (error: AwsCallError | Schema.SchemaError): Failure =>
        new SourceFailure({
          message:
            error._tag === "AwsCallError"
              ? `Cost Explorer ${error.message}`
              : `Cost Explorer answered ${operation} in a shape Estate does not know`,
        }),
    ),
  )

const day = (at: number) => new Date(at).toISOString().slice(0, 10)
const dayMs = 86_400_000

/** The first of this month and of the next, and yesterday, as Cost Explorer writes dates. */
export const datesAround = (now: number) => {
  const date = new Date(now)
  const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  const next = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  return { today: day(now), yesterday: day(now - dayMs), month: day(month), next: day(next) }
}

const tagOf = (entry: Billed) => entry.cost?.tag ?? entry.name

/** Each entry's cost, read in as few calls as Cost Explorer allows. */
export const readAwsCosts = (
  ce: AwsJson,
  tag: string,
  entries: ReadonlyArray<Billed>,
  now: number,
  currency: string,
): Effect.Effect<Readonly<Record<string, Cost>>, Failure> =>
  Effect.gen(function* () {
    const { today, yesterday, month, next } = datesAround(now)
    // From the earlier of the month's start and yesterday, so the 1st still has a yesterday.
    const start = yesterday < month ? yesterday : month
    const usage = yield* ask(
      ce,
      "GetCostAndUsage",
      {
        TimePeriod: { Start: start, End: today },
        Granularity: "DAILY",
        Metrics: ["UnblendedCost"],
        GroupBy: [{ Type: "TAG", Key: tag }],
      },
      Usage,
    )
    const spent = new Map<string, { monthToDate: number; yesterday: number }>()
    for (const period of usage.ResultsByTime)
      for (const group of period.Groups) {
        // A tag's group is keyed `tag$value`; the untagged rest is `tag$`.
        const value = (group.Keys[0] ?? "").split("$").slice(1).join("$")
        const amount = Number(group.Metrics["UnblendedCost"]?.Amount ?? 0)
        const was = spent.get(value) ?? { monthToDate: 0, yesterday: 0 }
        spent.set(value, {
          monthToDate: was.monthToDate + (period.TimePeriod.Start >= month ? amount : 0),
          yesterday: was.yesterday + (period.TimePeriod.Start === yesterday ? amount : 0),
        })
      }
    const budgeted = entries.filter((entry) => entry.cost?.budget?.per === "month" && spent.has(tagOf(entry)))
    const forecasts = yield* Effect.forEach(
      budgeted,
      (entry) =>
        ask(
          ce,
          "GetCostForecast",
          {
            TimePeriod: { Start: today, End: next },
            Metric: "UNBLENDED_COST",
            Granularity: "MONTHLY",
            Filter: { Tags: { Key: tag, Values: [tagOf(entry)] } },
          },
          Forecast,
        ).pipe(Effect.map((forecast) => [entry.name, Number(forecast.Total.Amount)] as const)),
      { concurrency: 2 },
    )
    const forecastOf = new Map(forecasts)
    const anomalies = yield* ask(
      ce,
      "GetAnomalies",
      { DateInterval: { StartDate: day(now - 7 * dayMs) }, MaxResults: 50 },
      Anomalies,
    )
    // An anomaly still open, on a monitor split by the tag, belongs to the entry the tag names.
    const anomalyOf = (value: string) =>
      anomalies.Anomalies.filter((each) => each.AnomalyEndDate === undefined && each.DimensionValue === value).map(
        (each) =>
          compact({
            since: (each.AnomalyStartDate ?? "").slice(0, 10),
            impact: each.Impact.MaxImpact,
            cause: each.RootCauses?.[0]?.Service,
          }),
      )[0]
    return Object.fromEntries(
      entries.flatMap((entry) => {
        const found = spent.get(tagOf(entry))
        if (found === undefined) return []
        const cost: Cost = compact({
          from: "AWS Cost Explorer",
          currency,
          monthToDate: found.monthToDate,
          yesterday: found.yesterday,
          forecast: forecastOf.get(entry.name),
          budget: entry.cost?.budget,
          anomaly: anomalyOf(tagOf(entry)),
        })
        return [[entry.name, cost] as const]
      }),
    )
  })
