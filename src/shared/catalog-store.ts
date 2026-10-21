/** Stores in the catalog (spec 0003), and the rule that finds Kafka clusters to make stores of (spec 0057). */
import { Schema } from "effect"

const optional = Schema.optionalKey

/** A database, queue or cache, read through its exporter's series with the preset for its engine. */
export const Store = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  /** The area it belongs to, such as payments or data: the overview groups lanes by it, and a screen can show one. */
  category: optional(Schema.String),
  environments: Schema.Array(Schema.String),
  engine: Schema.Literals(["postgres", "cnpg", "mysql", "redis", "kafka"]),
  /** The labels its exporter's series carry, as PromQL matchers. */
  selector: Schema.String,
  links: optional(Schema.Record(Schema.String, Schema.String)),
  extra: optional(
    Schema.Array(Schema.Struct({ title: Schema.String, query: Schema.String, unit: optional(Schema.String) })),
  ),
  /** The preset's thresholds, overridden for a store sized close to its limits on purpose. */
  attention: optional(Schema.Record(Schema.String, Schema.Number)),
  /** Set by discovery, never written: where the entry was found. */
  discovered: optional(Schema.Struct({ from: Schema.Literal("prometheus") })),
})
export type Store = typeof Store.Type

/** Kafka clusters found by kafka_exporter's series: one for each set of values of the labels in `by`. */
export const KafkaRule = Schema.Struct({
  by: Schema.Array(Schema.String),
  /** Matchers every one of the exporter's series must also carry, to find only these exporters' clusters. */
  selector: optional(Schema.String),
})

const { description, category, links, extra, attention } = Store.fields

/** What each cluster found becomes: a store's own fields, its values naming the rule's labels as `{label:KEY}`. */
export const StoreTemplate = Schema.Struct({
  name: optional(Schema.String),
  description,
  category,
  links,
  extra,
  attention,
  environments: optional(Schema.Array(Schema.String)),
})
