/** What a person includes in an incident from where they found it (spec 0051): a chart, lines, or an error group. */
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
])
export type Included = typeof Included.Type
