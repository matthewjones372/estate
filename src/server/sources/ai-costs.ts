/**
 * The AI providers' own cost reports, read with an admin key: Anthropic's by workspace, OpenAI's by project. This is
 * the bill, a day at a time, and it lags by hours; Estate's estimate from tokens fills the time it has not reached.
 */
import { Effect, Redacted, Schema } from "effect"
import { compact } from "../../shared/compact"
import type { Cost, CostOf } from "../../shared/costs"
import { callJson, type Remote } from "../remote"
import { datesAround } from "./aws-costs"
import { type Failure, SourceFailure } from "./run"

/** An agent whose spend a provider reports, by the workspace or project its catalog entry names. */
export interface Spender {
  readonly name: string
  readonly cost: CostOf
}

const AnthropicReport = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      starting_at: Schema.String,
      results: Schema.Array(
        Schema.Struct({ amount: Schema.String, workspace_id: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
      ),
    }),
  ),
})

const OpenAiReport = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      start_time: Schema.Number,
      results: Schema.Array(
        Schema.Struct({
          amount: Schema.Struct({ value: Schema.Number }),
          project_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    }),
  ),
})

/** A day's spend by whom the report groups it under: workspace or project. */
interface Day {
  readonly day: string
  readonly by: string
  readonly amount: number
}

const failed = (provider: string) => (error: { readonly _tag: string; readonly message: string }) =>
  new SourceFailure({
    message:
      error._tag === "RemoteError"
        ? `${provider}'s cost report ${error.message}`
        : `${provider}'s cost report answered in a shape Estate does not know`,
  })

const base = (url: string | undefined, fallback: string) => (url ?? fallback).replace(/\/$/, "")

/** Anthropic's cost report from the month's start, a day a bucket; its amounts are in cents. */
const anthropicDays = (key: Redacted.Redacted<string>, url: string | undefined, from: string) =>
  callJson({
    url: `${base(url, "https://api.anthropic.com")}/v1/organizations/cost_report?starting_at=${from}T00:00:00Z&bucket_width=1d&group_by[]=workspace_id&limit=31`,
    headers: { "x-api-key": Redacted.value(key), "anthropic-version": "2023-06-01" },
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(AnthropicReport)),
    Effect.map(
      (report): ReadonlyArray<Day> =>
        report.data.flatMap((bucket) =>
          bucket.results.map((result) => ({
            day: bucket.starting_at.slice(0, 10),
            by: result.workspace_id ?? "",
            amount: Number(result.amount) / 100,
          })),
        ),
    ),
    Effect.mapError(failed("Anthropic")),
  )

/** OpenAI's organization costs from the month's start, a day a bucket, grouped by project. */
const openAiDays = (key: Redacted.Redacted<string>, url: string | undefined, from: string) =>
  callJson({
    url: `${base(url, "https://api.openai.com")}/v1/organization/costs?start_time=${Date.parse(`${from}T00:00:00Z`) / 1000}&bucket_width=1d&group_by=project_id&limit=31`,
    headers: { authorization: `Bearer ${Redacted.value(key)}` },
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(OpenAiReport)),
    Effect.map(
      (report): ReadonlyArray<Day> =>
        report.data.flatMap((bucket) =>
          bucket.results.map((result) => ({
            day: new Date(bucket.start_time * 1000).toISOString().slice(0, 10),
            by: result.project_id ?? "",
            amount: result.amount.value,
          })),
        ),
    ),
    Effect.mapError(failed("OpenAI")),
  )

const costFrom = (
  from: string,
  days: ReadonlyArray<Day>,
  by: string,
  spender: Spender,
  now: number,
  currency: string,
): Cost => {
  const { month, yesterday } = datesAround(now)
  const mine = days.filter((each) => each.by === by)
  const sum = (keep: (day: string) => boolean) =>
    mine.filter((each) => keep(each.day)).reduce((total, each) => total + each.amount, 0)
  return compact({
    from,
    currency,
    monthToDate: sum((day) => day >= month),
    yesterday: sum((day) => day === yesterday),
    budget: spender.cost.budget,
  })
}

type Admin = { readonly adminKey: Redacted.Redacted<string>; readonly url?: string }

/** Each agent's spend from its provider's report, where the catalog names its workspace or project. */
export const readAiCosts = (
  providers: { readonly anthropic?: Admin; readonly openai?: Admin },
  spenders: ReadonlyArray<Spender>,
  now: number,
  currency: string,
): Effect.Effect<Readonly<Record<string, Cost>>, Failure, Remote> =>
  Effect.gen(function* () {
    const { month, yesterday } = datesAround(now)
    const from = yesterday < month ? yesterday : month
    const { anthropic, openai } = providers
    const onAnthropic = spenders.filter((each) => each.cost.anthropic !== undefined)
    const onOpenAi = spenders.filter((each) => each.cost.openai !== undefined)
    const [claude, gpt] = yield* Effect.all(
      [
        anthropic === undefined || onAnthropic.length === 0
          ? Effect.succeed([])
          : anthropicDays(anthropic.adminKey, anthropic.url, from),
        openai === undefined || onOpenAi.length === 0
          ? Effect.succeed([])
          : openAiDays(openai.adminKey, openai.url, from),
      ],
      { concurrency: 2 },
    )
    return Object.fromEntries([
      ...(anthropic === undefined
        ? []
        : onAnthropic.map(
            (each) =>
              [
                each.name,
                costFrom("Anthropic", claude, each.cost.anthropic?.workspace ?? "", each, now, currency),
              ] as const,
          )),
      ...(openai === undefined
        ? []
        : onOpenAi.map(
            (each) =>
              [each.name, costFrom("OpenAI", gpt, each.cost.openai?.project ?? "", each, now, currency)] as const,
          )),
    ])
  })
