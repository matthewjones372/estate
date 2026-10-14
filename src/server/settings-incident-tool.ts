/** `incidentTool:` in the settings (spec 0043): the one tool an Estate raises its incidents in, and reads them back from. */
import { Schema } from "effect"
import type { Mistake } from "../shared/shape"
import { Secret } from "./secret"
import { notADuration, secondsIn } from "./settings-every"

const optional = Schema.optionalKey

/** PagerDuty's REST API: a key, the user it raises as, the service an incident goes to, and how often it is read. */
const PagerDuty = Schema.Struct({
  token: Secret,
  from: Schema.String,
  service: Schema.String,
  every: optional(Schema.String),
  /** api.pagerduty.com unless set, as for an account in the EU. */
  url: optional(Schema.String),
})
export type PagerDutySettings = typeof PagerDuty.Type

export const IncidentTool = Schema.Struct({ pagerduty: optional(PagerDuty) })
type IncidentTool = typeof IncidentTool.Type

const shortest = 5

export const incidentToolMistakes = (tool: IncidentTool | undefined): ReadonlyArray<Mistake> => {
  const every = tool?.pagerduty?.every
  if (every === undefined) return []
  const seconds = secondsIn(every)
  const at = "incidentTool.pagerduty.every"
  if (seconds === undefined) return [{ at, message: notADuration(every) }]
  return seconds < shortest ? [{ at, message: `"${every}" is under ${shortest}s, the most often Estate reads` }] : []
}
