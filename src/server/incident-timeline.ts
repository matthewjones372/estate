/** An incident's timeline: the events of each of its firings and its own, merged in the order they happened. */
import { Effect } from "effect"
import type { Incident, IncidentEvent } from "../shared/incidents"
import { mergedOnce } from "../shared/timeline"
import { Notes } from "./notes"

export const incidentTimeline = (incident: Incident) =>
  Effect.gen(function* () {
    const notes = yield* Notes
    const firings = yield* Effect.forEach(incident.firings, (firing) =>
      Effect.map(notes.events(firing), (all) => all.map(({ startsAt: _, ...event }): IncidentEvent => event)),
    )
    const own = (yield* notes.incidentEvents(incident.id)).map(({ incident: _, ...event }): IncidentEvent => event)
    return mergedOnce([...firings.flat(), ...own])
  })
