/**
 * An incident as one reader reads it, on its page and in its exports: its events, services, versions, window and
 * evidence, and its timeline as an export says it. Logs, and AI answers and traces drawn from them, are left out for a
 * reader who may not read logs here.
 */
import { Effect, SubscriptionRef } from "effect"
import { versionsOf } from "../../shared/incident-versions"
import type { Incident } from "../../shared/incidents"
import { seenBy } from "../../shared/timeline"
import type { TimelineExport } from "../../shared/timeline-export"
import { incidentTimeline } from "../incident-timeline"
import { Notes } from "../notes"
import { Configured } from "../settings"
import { leadMinutes } from "../settings-incidents"
import { Estate } from "../state"
import { isoNow } from "../time"
import { incidentServices, incidentWindow } from "../views/incident-scope"
import { incidentFirings } from "../views/timeline-export"

export const recordFor = (incident: Incident, reads: boolean) =>
  Effect.gen(function* () {
    const events = yield* incidentTimeline(incident)
    const settings = yield* Configured
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const services = incidentServices(estate, incident)
    const window = incidentWindow(incident, leadMinutes(settings.incidents), yield* isoNow)
    const versions = versionsOf(events, services, estate.catalog.services)
    const evidence = (yield* (yield* Notes).evidence(incident.id)).map(({ logs, traces, ...set }) =>
      reads ? { ...set, ...(logs === undefined ? {} : { logs }), ...(traces === undefined ? {} : { traces }) } : set,
    )
    return { incident, events: seenBy(events, reads), services, versions, evidence, window }
  })

/** Its timeline to take away, each event on a firing naming its alert, one on the incident itself naming none. */
export const timelineFor = (incident: Incident, reads: boolean) =>
  Effect.gen(function* () {
    const firings = incidentFirings(yield* SubscriptionRef.get(yield* Estate), incident)
    const events = (yield* incidentTimeline(incident)).map(({ environment, alert, ...event }) => {
      const name = firings.find((each) => each.environment === environment && each.alert === alert)?.name
      return name === undefined ? event : { ...event, alert: name }
    })
    const { title, firings: _, ...kept } = incident
    const timeline: TimelineExport = { title, incident: kept, firings, events: seenBy(events, reads) }
    return timeline
  })
