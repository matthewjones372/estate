/** The incident a firing is part of, and its notes as a card or a page shows them: each saying which incident. */
import type { Incident } from "../../shared/incidents"
import { sameFiring } from "../notes"
import type { EstateState } from "../state"

/** The incident this firing of an alert is part of: its open one, else the closed one it was in, if any. */
export const incidentOf = (
  estate: EstateState,
  environment: string,
  alert: { readonly id: string; readonly startsAt: string },
): Incident | undefined => {
  const holding = (estate.incidents ?? []).filter((incident) =>
    incident.firings.some((each) => sameFiring(each, { environment, alert: alert.id, startsAt: alert.startsAt })),
  )
  return holding.find((incident) => incident.closedAt === undefined) ?? holding[0]
}

/** An incident's notes, each naming the incident it was written on. */
export const notesOn = (incident: Incident | undefined) =>
  incident === undefined
    ? []
    : (incident.notes ?? []).map((note) => ({ ...note, incident: { id: incident.id, title: incident.title } }))
