/** What an ask cost: its tokens priced by the settings, and how many of them count against the day's budget. */
import type { Usage } from "./model-apis"
import type { Prices } from "./settings"

type Price = Prices[string]

/** What the provider charges for an ask, per million tokens; cached input at input's price where none is set. */
export const costOf = (usage: Usage, price: Price): number =>
  (usage.input * price.input + usage.cached * (price.cachedInput ?? price.input) + usage.output * price.output) /
  1_000_000

/** Tokens against the budget as paid for: cached input at its share of input's price, or whole without a price. */
export const budgeted = (usage: Usage, price: Price | undefined): number => {
  const share = price === undefined ? 1 : (price.cachedInput ?? price.input) / price.input
  return Math.round(usage.input + usage.output + usage.cached * share)
}
