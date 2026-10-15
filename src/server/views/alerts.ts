/** The `alerts` event: firing, pending and silenced together, each with its service or store, notes and chart. */
import { Option } from "effect"
import { compact } from "../../shared/compact"
import type { AlertsEvent } from "../../shared/events"
import { sameFiring } from "../notes"
import type { EstateState } from "../state"
import { serviceOf } from "./health"
import { incidentOf, notesOn } from "./incident-of"
import { storeOf, storesIn } from "./stores"
import { suggestedFor } from "./suggested"

const order = { firing: 0, pending: 1, silenced: 2 } as const
/** How many earlier firings an alert carries to the page. */
const kept = 20
const severities: Readonly<Record<string, number>> = { critical: 0, warning: 1 }

/** The Slack thread this firing of an alert was told in, if it was. */
const threadOf = (
  estate: EstateState,
  environment: string,
  alert: { readonly id: string; readonly startsAt: string },
) => {
  const told = estate.threads?.find((each) =>
    sameFiring(each, { environment, alert: alert.id, startsAt: alert.startsAt }),
  )
  return told === undefined ? undefined : { url: told.url }
}

/** What an alert means for the people using the product: written on the page, in the catalog, or on its rule. */
export const impactOf = (estate: EstateState, name: string, said?: string) => {
  const onPage = estate.impacts?.find((each) => each.alert === name)
  const written = estate.catalog.alerts?.[name]?.impact
  return onPage !== undefined
    ? { text: onPage.text, from: "page" as const, by: onPage.by, at: onPage.at }
    : written !== undefined
      ? { text: written, from: "catalog" as const }
      : said === undefined
        ? undefined
        : { text: said, from: "rule" as const }
}

/** The alerts in `environment`; with `suggestWithin`, for someone who may link, each with an incident it may belong to. */
export const alertsView = (
  estate: EstateState,
  environment: string,
  silences: boolean,
  suggestWithin?: number,
): AlertsEvent => {
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
    const incident = incidentOf(estate, environment, alert)
    // This firing's notes on the card, and its incident's, which say so; earlier ones with the firing they were in.
    const notes = [...about.filter((note) => note.at >= alert.startsAt), ...notesOn(incident)].sort((a, b) =>
      b.at.localeCompare(a.at),
    )
    const earlier = (estate.firings ?? [])
      .filter(
        (firing) =>
          firing.environment === environment &&
          firing.alert === alert.id &&
          Date.parse(firing.startsAt) < Date.parse(alert.startsAt),
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
    const store = storeOf(alert.labels, stores)
    // Only a firing in no open incident is suggested, so one already in an incident is not looked at again.
    const suggested =
      suggestWithin === undefined || (incident !== undefined && incident.closedAt === undefined)
        ? undefined
        : Option.getOrUndefined(suggestedFor(estate, environment, { ...alert, service, store }, suggestWithin))
    return compact({
      ...shown,
      impact: impactOf(estate, alert.name, said),
      service,
      store,
      runbook,
      notes,
      history: history.length === 0 ? undefined : history,
      chart: state.metrics.value?.charts[alert.id],
      thread: threadOf(estate, environment, alert),
      incident:
        incident === undefined
          ? undefined
          : {
              id: incident.id,
              title: incident.title,
              closed: incident.closedAt !== undefined,
              openedAt: incident.openedAt,
              ...(incident.link === undefined ? {} : { link: incident.link }),
            },
      suggested,
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
          alert: each.alert,
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
