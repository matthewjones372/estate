/** The settings for costs: where each environment's bill is read, and the prices of the tokens agents spend. */
import { Schema } from "effect"
import { Secret } from "./secret"

const optional = Schema.optionalKey

/** An environment's cost tools: AWS Cost Explorer by tag, OpenCost, and the AI providers' cost reports. */
export const Costs = Schema.Struct({
  /** Cost Explorer in the account the environment runs in, split by the cost allocation tag that names an entry. */
  aws: optional(Schema.Struct({ region: Schema.String, tag: Schema.String, endpoint: optional(Schema.String) })),
  /** OpenCost, or Kubecost's API, for what runs in Kubernetes with no tag of its own. */
  opencost: optional(Schema.Struct({ url: Schema.String })),
  anthropic: optional(Schema.Struct({ adminKey: Secret, url: optional(Schema.String) })),
  openai: optional(Schema.Struct({ adminKey: Secret, url: optional(Schema.String) })),
  /** The currency the bill is in, as the tools report it: USD unless set. */
  currency: optional(Schema.String),
})

/** What a model's tokens cost, per million, for the estimate between the providers' reports. */
export const Prices = Schema.Record(Schema.String, Schema.Struct({ input: Schema.Number, output: Schema.Number }))
