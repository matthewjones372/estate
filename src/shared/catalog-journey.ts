/** A journey in the catalog: a request that crosses the estate, the span that starts one, and its stages (spec 0046). */
import { Schema } from "effect"

const optional = Schema.optionalKey

/**
 * One edge of a span, by its name and, where another service has a span of that name, its service: where a stage
 * between two spans starts or ends.
 */
const Edge = Schema.Union([
  Schema.Struct({ start: Schema.String, service: optional(Schema.String) }),
  Schema.Struct({ end: Schema.String, service: optional(Schema.String) }),
])
export type Edge = typeof Edge.Type

/**
 * A stage: a span's whole length (`span:`), or from one span's edge to another's (`from:`/`to:`). `where` names the
 * map's node, a service or a store it happens in, which is its lane on a trace's page.
 */
const Stage = Schema.Struct({
  title: Schema.String,
  where: Schema.String,
  span: optional(Schema.String),
  /** The span's service, where its name alone could be another service's span. */
  service: optional(Schema.String),
  from: optional(Edge),
  to: optional(Edge),
})
export type Stage = typeof Stage.Type

export const Journey = Schema.Struct({
  name: Schema.String,
  title: optional(Schema.String),
  environments: Schema.Array(Schema.String),
  /** A trace is this journey when it holds a span of this name from this service, as its resource names it. */
  start: Schema.Struct({ service: Schema.String, span: Schema.String }),
  stages: Schema.Array(Stage),
})
export type Journey = typeof Journey.Type
