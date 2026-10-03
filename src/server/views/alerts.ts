/** The `alerts` event: firing, pending and silenced together, each with its service or store, notes and chart. */
import { compact } from "../../shared/compact"
import type { AlertsEvent } from "../../shared/events"
import type { EstateState } from "../state"
import { serviceOf } from "./health"
import { storeOf, storesIn } from "./stores"

const order = { firing: 0, pending: 1, silenced: 2 } as const
/** How many earlier firings an alert carries to the page. */
const kept = 20
const severities: Readonly<Record<string, number>> = { critical: 0, warning: 1 }

export const alertsView = (estate: EstateState, environment: string, silences: boolean): AlertsEvent => {
  const state = estate.environments[environment]
  if (state === undefined) return { alerts: [], resolved: [], silences }
  const services = estate.catalog.services
  const stores = storesIn(estate.catalog, environment)
  const alerts = (state.alerts.value ?? []).map((alert) => {
    const service = serviceOf(alert.labels, services)
    const runbook = alert.runbook ?? services.find((each) => each.name === service)?.runbook
    const about = estate.notes
      .filter((note) => note.environment === environment && note.alert === alert.id)
      .map(({ id, at, by, text }) => ({ id, at, by, text }))
      .sort((a, b) => b.at.localeCompare(a.at))
    // This firing's notes on the card; earlier ones with the firing they were written in.
    const notes = about.filter((note) => note.at >= alert.startsAt)
    const earlier = (estate.firings ?? [])
      .filter(
        (firing) => firing.environment === environment && firing.alert === alert.id && firing.startsAt < alert.startsAt,
      )
      .toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))
      .slice(0, kept)
    const history = earlier.map((firing, index) => {
      const until = earlier[index - 1]?.startsAt ?? alert.startsAt
      return compact({
        startsAt: firing.startsAt,
        endsAt: firing.endsAt,
        silence: firing.silence,
        notes: about.filter((note) => note.at >= firing.startsAt && note.at < until),
      })
    })
    const { expression: _, impact: said, ...shown } = alert
    const onPage = estate.impacts?.find((each) => each.alert === alert.name)
    const written = estate.catalog.alerts?.[alert.name]?.impact
    return compact({
      ...shown,
      impact:
        onPage !== undefined
          ? { text: onPage.text, from: "page" as const, by: onPage.by, at: onPage.at }
          : written !== undefined
            ? { text: written, from: "catalog" as const }
            : said === undefined
              ? undefined
              : { text: said, from: "rule" as const },
      service,
      store: storeOf(alert.labels, stores),
      runbook,
      notes,
      history: history.length === 0 ? undefined : history,
      chart: state.metrics.value?.charts[alert.id],
    })
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
          store: storeOf(each.labels, stores),
          startsAt: each.startsAt,
          endsAt: each.endsAt,
        }),
      )
      .sort((a, b) => b.endsAt.localeCompare(a.endsAt)),
    silences,
  }
}
