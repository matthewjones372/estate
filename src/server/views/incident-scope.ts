/** What an incident is about and when: its services and stores, and the window its record covers (spec 0047). */
import type { Incident } from "../../shared/incidents"
import type { EstateState } from "../state"
import { anchorOf } from "./suggested"

/** Its firings' services and stores, then those an operator added, each once. */
export const incidentServices = (estate: EstateState, incident: Incident): ReadonlyArray<string> => [
  ...new Set([
    ...incident.firings.flatMap((firing) => {
      const { service, store } = anchorOf(estate, firing)
      return service ?? store ?? []
    }),
    ...(incident.added ?? []).map((each) => each.service),
  ]),
]

/** From `lead` minutes before its first firing, or its opening if earlier, to its close, or `now` while open. */
export const incidentWindow = (incident: Incident, lead: number, now: string) => {
  const first = Math.min(Date.parse(incident.openedAt), ...incident.firings.map((each) => Date.parse(each.startsAt)))
  return { from: new Date(first - lead * 60_000).toISOString(), to: incident.closedAt ?? now }
}
