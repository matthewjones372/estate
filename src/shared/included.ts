/** What a person includes in an incident from where they found it (spec 0051): a chart, lines, an error group, a trace. */
import { Schema } from "effect"
import { ErrorGroup, LogLine } from "./log-events"

const where = { environment: Schema.String, service: Schema.String, why: Schema.optionalKey(Schema.String) }

export const Included = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("chart"),
    ...where,
    panel: Schema.String,
    from: Schema.String,
    to: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("lines"), ...where, lines: Schema.Array(LogLine) }),
  Schema.Struct({ kind: Schema.Literal("errors"), ...where, group: ErrorGroup }),
  Schema.Struct({
    kind: Schema.Literal("trace"),
    environment: Schema.String,
    id: Schema.String,
    journey: Schema.optionalKey(Schema.String),
    why: Schema.optionalKey(Schema.String),
  }),
])
export type Included = typeof Included.Type
