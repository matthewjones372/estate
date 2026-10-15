/** The incident tool the settings name: one kind an Estate, by its key under `incidentTool`. */
import type { Settings } from "../settings"
import type { IncidentTool } from "./incident-tools"
import { incidentIo } from "./incidentio"
import { pagerDuty } from "./pagerduty"

export const incidentToolOf = (settings: Settings): IncidentTool | undefined => {
  const { pagerduty, incidentio } = settings.incidentTool ?? {}
  if (pagerduty !== undefined) return pagerDuty(pagerduty)
  return incidentio === undefined ? undefined : incidentIo(incidentio)
}
