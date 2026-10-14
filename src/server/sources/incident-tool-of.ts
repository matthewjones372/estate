/** The incident tool the settings name: one kind an Estate, by its key under `incidentTool`. */
import type { Settings } from "../settings"
import type { IncidentTool } from "./incident-tools"
import { pagerDuty } from "./pagerduty"

export const incidentToolOf = (settings: Settings): IncidentTool | undefined => {
  const pagerduty = settings.incidentTool?.pagerduty
  return pagerduty === undefined ? undefined : pagerDuty(pagerduty)
}
