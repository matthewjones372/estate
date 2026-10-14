/** The doctor's `incident` line: whether the incident tool answers, and whom it raises as (spec 0043). */
import { Effect } from "effect"
import { type Finding, finding } from "./doctor-finding"
import type { Settings } from "./settings"
import { incidentToolOf } from "./sources/incident-tool-of"

/** The line, where an incident tool is set; none otherwise. */
export const incidentToolFinding = (settings: Settings) => {
  const tool = incidentToolOf(settings)
  return tool === undefined
    ? Effect.succeed<Finding | undefined>(undefined)
    : finding("incident", tool.check, (said) => `${tool.name} ${said}`)
}
