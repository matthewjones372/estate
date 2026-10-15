/** A firing as a review reads it: what it was about, when it fired and resolved, its impact and its notes. */
import { compact } from "../../shared/compact"
import type { Incident } from "../../shared/incidents"
import type { ExportedFiring } from "../../shared/timeline-export"
import type { EstateState } from "../state"
import { alertsView } from "./alerts"
import { pastFiring } from "./firing"

const oldestFirst = <A extends { readonly at: string }>(notes: ReadonlyArray<A>) =>
  notes.toSorted((a, b) => a.at.localeCompare(b.at))

/**
 * The firing of alert `id` in `environment` that started at `at`, however the time is written: the live one if it is
 * still firing, else as kept; without `at`, the live one, else its latest. None once swept.
 */
export const exportedFiring = (
  estate: EstateState,
  environment: string,
  id: string,
  at?: string,
): ExportedFiring | undefined => {
  const live = alertsView(estate, environment, false).alerts.find(
    (alert) => alert.id === id && (at === undefined || Date.parse(alert.startsAt) === Date.parse(at)),
  )
  const past = live === undefined ? pastFiring(estate, environment, id, at) : undefined
  const firing = live ?? past
  if (firing === undefined) return undefined
  return compact({
    environment,
    alert: id,
    name: firing.name,
    service: firing.service,
    store: firing.store,
    severity: firing.severity,
    summary: firing.summary,
    startsAt: firing.startsAt,
    endsAt: past?.endsAt,
    firing: live !== undefined,
    impact: firing.impact?.text,
    // Its own notes; those on its incident are the incident's, so an incident's export has each once.
    notes: oldestFirst(firing.notes.flatMap((note) => ("incident" in note ? [] : [note]))),
  })
}

/** An incident's firings as they read now; one swept since is still named, with what the incident kept of it. */
export const incidentFirings = (estate: EstateState, incident: Incident): ReadonlyArray<ExportedFiring> =>
  incident.firings.map(
    (each) =>
      exportedFiring(estate, each.environment, each.alert, each.startsAt) ?? {
        environment: each.environment,
        alert: each.alert,
        name: each.name ?? each.alert,
        startsAt: each.startsAt,
        firing: false,
        notes: [],
      },
  )
