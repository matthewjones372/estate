/** The `alerts` event: firing, pending and silenced together, each with its service, notes and chart. */
import { compact } from "../../shared/compact"
import type { AlertsEvent } from "../../shared/events"
import type { EstateState } from "../state"
import { serviceOf } from "./health"

const order = { firing: 0, pending: 1, silenced: 2 } as const
const severities: Readonly<Record<string, number>> = { critical: 0, warning: 1 }

export const alertsView = (estate: EstateState, environment: string, silences: boolean): AlertsEvent => {
  const state = estate.environments[environment]
  if (state === undefined) return { alerts: [], resolved: [], silences }
  const services = estate.catalog.services
  const alerts = (state.alerts.value ?? []).map((alert) => {
    const service = serviceOf(alert.labels, services)
    const runbook = alert.runbook ?? services.find((each) => each.name === service)?.runbook
    const notes = estate.notes
      .filter((note) => note.environment === environment && note.alert === alert.id)
      .map(({ id, at, by, text }) => ({ id, at, by, text }))
      .sort((a, b) => b.at.localeCompare(a.at))
    const { expression: _, ...shown } = alert
    return compact({ ...shown, service, runbook, notes, chart: state.metrics.value?.charts[alert.id] })
  })
  alerts.sort(
    (a, b) =>
      order[a.state] - order[b.state] ||
      (severities[a.severity] ?? 2) - (severities[b.severity] ?? 2) ||
      a.startsAt.localeCompare(b.startsAt),
  )
  return {
    alerts,
    resolved: state.resolved
      .map((each) =>
        compact({
          name: each.name,
          service: serviceOf(each.labels, services),
          startsAt: each.startsAt,
          endsAt: each.endsAt,
        }),
      )
      .sort((a, b) => b.endsAt.localeCompare(a.endsAt)),
    silences,
  }
}
