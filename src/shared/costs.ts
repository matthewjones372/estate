/**
 * What an entry costs: how the catalog says to find its share of the bill and its budget, and what the page is sent.
 * The bill as the tool reports it, and Estate's estimate from tokens, are kept apart and named as what they are.
 */
import { Schema } from "effect"

const optional = Schema.optionalKey

const Budget = Schema.Struct({ amount: Schema.Number, per: Schema.Literals(["day", "month"]) })

/** In the catalog: where an entry's cost is found, where its name is not enough, and the budget it keeps to. */
export const CostOf = Schema.Struct({
  /** The value of the cost allocation tag that names it in the bill: its own name unless set. */
  tag: optional(Schema.String),
  /** Its namespace and workload in OpenCost's allocation: its runtime's unless set. */
  opencost: optional(Schema.Struct({ namespace: Schema.String, workload: optional(Schema.String) })),
  /** The workspace or project an AI provider bills its tokens to. */
  anthropic: optional(Schema.Struct({ workspace: Schema.String })),
  openai: optional(Schema.Struct({ project: Schema.String })),
  budget: optional(Budget),
})
export type CostOf = typeof CostOf.Type

/** A cost anomaly the billing tool found in an entry's spend. */
const Anomaly = Schema.Struct({
  since: Schema.String,
  /** What it adds a day, in the bill's currency. */
  impact: Schema.Number,
  cause: optional(Schema.String),
})

/** On the page: an entry's cost as its tool reports it, and Estate's labelled estimate where there is one. */
export const Cost = Schema.Struct({
  /** The tool the figures come from: AWS Cost Explorer, OpenCost, Anthropic, OpenAI. */
  from: Schema.String,
  currency: Schema.String,
  monthToDate: optional(Schema.Number),
  yesterday: optional(Schema.Number),
  /** What the month will come to, as the tool forecasts it. */
  forecast: optional(Schema.Number),
  budget: optional(Budget),
  anomaly: optional(Anomaly),
  /** Estate's own estimate from tokens and the price table, between the provider's reports: never the bill. */
  estimate: optional(Schema.Struct({ lastHour: Schema.Number, atThisRate: Schema.Number })),
})
export type Cost = typeof Cost.Type

const money = (amount: number, currency: string) =>
  `${currency === "USD" ? "$" : `${currency} `}${amount >= 100 ? Math.round(amount) : amount.toFixed(2)}`

/** Why an entry's cost needs someone: an anomaly, or a budget its forecast or its rate will pass. */
export const costReasons = (cost: Cost | undefined): ReadonlyArray<string> => {
  if (cost === undefined) return []
  const { currency, budget, anomaly, forecast, estimate, yesterday } = cost
  const reasons: Array<string> = []
  if (anomaly !== undefined)
    reasons.push(
      `cost anomaly: +${money(anomaly.impact, currency)} a day since ${anomaly.since}${anomaly.cause === undefined ? "" : ` (${anomaly.cause})`}`,
    )
  if (budget?.per === "month" && forecast !== undefined && forecast > budget.amount)
    reasons.push(`forecast ${money(forecast, currency)} passes its ${money(budget.amount, currency)} a month`)
  if (budget?.per === "day" && estimate !== undefined && estimate.atThisRate > budget.amount)
    reasons.push(`will pass its ${money(budget.amount, currency)} today at this rate (est.)`)
  else if (budget?.per === "day" && yesterday !== undefined && yesterday > budget.amount)
    reasons.push(`spent ${money(yesterday, currency)} yesterday, over its ${money(budget.amount, currency)} a day`)
  return reasons
}

/**
 * An agent's cost with Estate's estimate beside the bill: what the last hour cost at its rate, and what a day at that
 * rate comes to. Where no tool reports its cost, the estimate stands alone, and is still named as one.
 */
export const withEstimate = (
  cost: Cost | undefined,
  perHour: number | undefined,
  budget: CostOf["budget"],
): Cost | undefined => {
  if (perHour === undefined) return cost
  const estimate = { lastHour: perHour, atThisRate: perHour * 24 }
  return cost === undefined
    ? { from: "Estate's estimate", currency: "USD", ...(budget === undefined ? {} : { budget }), estimate }
    : { ...cost, estimate }
}
