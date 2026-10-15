/**
 * Raising an open incident in the incident tool (spec 0043), for an operator where Estate writes. The record keeps
 * the tool's link and what reading it back needs; one already raised answers with its link and raises nothing.
 */
import { Effect, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { compact } from "../../shared/compact"
import type { Incident } from "../../shared/incidents"
import { happenedOnEach } from "../happened"
import { Configured, type Settings } from "../settings"
import { incidentToolOf } from "../sources/incident-tool-of"
import { type Raising, teamToolsOf } from "../sources/incident-tools"
import { Estate, type EstateState } from "../state"
import { isoNow } from "../time"
import { impactOf } from "../views/alerts"
import { serviceOf } from "../views/health"
import { answered, keep, keyOf, oneAtATime, open, operator, refuse } from "./incident-record"
import { json } from "./routes"

/** What the tool is told: each firing as Estate knows it now, what they do to people, and the way back to Estate. */
const raisingOf = (estate: EstateState, settings: Settings, incident: Incident, by: string): Raising => {
  const firings = incident.firings.map((firing) => {
    const live = estate.environments[firing.environment]?.alerts.value?.find((each) => each.id === firing.alert)
    return compact({
      environment: firing.environment,
      name: firing.name ?? live?.name ?? firing.alert,
      service: live === undefined ? undefined : serviceOf(live.labels, estate.catalog.services),
      severity: live?.severity,
      startsAt: firing.startsAt,
      impact: live === undefined ? undefined : impactOf(estate, live.name, live.impact)?.text,
    })
  })
  const impacts = [...new Set(firings.flatMap((firing) => (firing.impact === undefined ? [] : [firing.impact])))]
  const publicUrl = settings.auth.oidc?.publicUrl
  return compact({
    key: incident.id,
    title: incident.title,
    impact: impacts.length === 0 ? undefined : impacts.join("; "),
    firings: firings.map(({ impact: _, ...firing }) => firing),
    page:
      publicUrl === undefined
        ? undefined
        : `${publicUrl.replace(/\/$/, "")}/incidents/${encodeURIComponent(incident.id)}`,
    by,
    team: teamToolsOf(estate.catalog, firings[0]?.service),
  })
}

export const incidentRaiseRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/raise",
  Effect.gen(function* () {
    const person = yield* operator
    const settings = yield* Configured
    const tool = incidentToolOf(settings)
    if (tool === undefined) return yield* refuse(404, "Estate has no incident tool")
    const { id = "" } = yield* HttpRouter.params
    // Held while the tool is asked, so a second press waits and finds the first one's link rather than raising again.
    const { incident, raised } = yield* oneAtATime(
      Effect.gen(function* () {
        const incident = yield* open(id)
        if (incident.raised !== undefined) return { incident, raised: false }
        const estate = yield* SubscriptionRef.get(yield* Estate)
        const made = yield* tool
          .raise(raisingOf(estate, settings, incident, person.name))
          .pipe(Effect.catchTag("SourceFailure", (failure) => refuse(502, failure.message)))
        const now: Incident = {
          ...incident,
          link: made.url,
          raised: { tool: tool.name, id: made.id, by: person.name, at: yield* isoNow },
        }
        yield* keep(now)
        return { incident: now, raised: true }
      }),
    )
    if (raised)
      yield* happenedOnEach(incident.firings.map(keyOf), person.name, "incident-raised", tool.name, {
        ...(incident.link === undefined ? {} : { link: incident.link }),
      })
    return json(incident)
  }).pipe(answered),
)
