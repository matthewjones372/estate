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

/**
 * incident.io's API: a key that may create incidents, the severity an incident is raised at by its name, and `test`
 * to raise without announcing, for a demo.
 */
const IncidentIo = Schema.Struct({
  token: Secret,
  severity: Schema.String,
  mode: optional(Schema.Literals(["standard", "test"])),
  /** Public unless set: a private incident is seen only by those invited to it. */
  visibility: optional(Schema.Literals(["public", "private"])),
  every: optional(Schema.String),
  /** api.incident.io unless set. */
  url: optional(Schema.String),
})
export type IncidentIoSettings = typeof IncidentIo.Type

export const IncidentTool = Schema.Struct({ pagerduty: optional(PagerDuty), incidentio: optional(IncidentIo) })
type IncidentTool = typeof IncidentTool.Type

const shortest = 5
const usual = 60

/** How often each open incident raised in the tool is read back, in seconds: a minute unless set. */
export const readBackEvery = (tool: IncidentTool | undefined): number =>
  secondsIn(tool?.pagerduty?.every ?? tool?.incidentio?.every ?? "") ?? usual

const everyMistakes = (kind: string, every: string | undefined): ReadonlyArray<Mistake> => {
  if (every === undefined) return []
  const seconds = secondsIn(every)
  const at = `incidentTool.${kind}.every`
  if (seconds === undefined) return [{ at, message: notADuration(every) }]
  return seconds < shortest ? [{ at, message: `"${every}" is under ${shortest}s, the most often Estate reads` }] : []
}

export const incidentToolMistakes = (tool: IncidentTool | undefined): ReadonlyArray<Mistake> => [
  ...(tool?.pagerduty !== undefined && tool.incidentio !== undefined
    ? [{ at: "incidentTool", message: "names one tool an Estate raises in: pagerduty or incidentio" }]
    : []),
  ...everyMistakes("pagerduty", tool?.pagerduty?.every),
  ...everyMistakes("incidentio", tool?.incidentio?.every),
]
