/**
 * An incident's run-up, rebuilt from what Estate holds when it opens or a service joins it (spec 0047): the version
 * running at its window's start, or that the one before a later deploy is not known here; the deploys and builds in
 * its window; and its pods' restarts so far. Each is kept as one of its events, marked rebuilt.
 */
import { Effect, SubscriptionRef } from "effect"
import type { Incident } from "../shared/incidents"
import { Notes } from "./notes"
import { type Change, finished, podsOf, restarted, runningOf } from "./seen"
import { Configured } from "./settings"
import { leadMinutes } from "./settings-incidents"
import { Estate, type EstateState } from "./state"
import { isoNow } from "./time"
import { incidentServices, incidentWindow } from "./views/incident-scope"

type Rebuilt = Change & { readonly at: string; readonly service: string }

/** What Estate holds of `services` in the incident's environments, from `from` to `now`, oldest first. */
const runUp = (
  estate: EstateState,
  incident: Incident,
  services: ReadonlyArray<string>,
  from: string,
  now: string,
): ReadonlyArray<Rebuilt> => {
  const environments = [...new Set(incident.firings.map((firing) => firing.environment))].sort()
  const since = (at: string | undefined) => at !== undefined && Date.parse(at) >= Date.parse(from)
  return environments
    .flatMap((environment, index) =>
      services.flatMap((service) => {
        const state = estate.environments[environment]
        const pods = podsOf(state, service)
        const running = runningOf(pods)
        const chosen = state?.deploys.value?.[service]
        // Estate holds only the latest deploy, so one inside the window hides the version before it.
        const versions: ReadonlyArray<Omit<Rebuilt, "service">> =
          chosen !== undefined && since(chosen.at)
            ? [
                {
                  at: from,
                  kind: "version-seen",
                  text: `the version of ${service} before ${chosen.version} is not known here`,
                },
                {
                  at: chosen.at ?? from,
                  kind: "deployed",
                  text: `${service} ${chosen.version} deployed in ${environment}`,
                },
              ]
            : running === undefined
              ? []
              : [{ at: from, kind: "version-seen", text: `${service} ${running} running in ${environment}` }]
        // A build is no environment's, so it is told once, with the first.
        const builds =
          index === 0
            ? (estate.builds.value?.[service] ?? [])
                .filter((build) => since(build.at))
                .flatMap((build) => finished(service, build).map((change) => ({ ...change, at: build.at })))
            : []
        const restarts = (pods ?? []).filter((pod) => pod.restarts > 0).map((pod) => ({ ...restarted(pod), at: now }))
        return [...versions, ...builds, ...restarts].map((event) => ({ ...event, service }))
      }),
    )
    .toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** The run-up of the services `now` has that `was` did not, kept as its events; a store that will not is a warning. */
export const keepRunUp = (was: Incident | undefined, now: Incident) =>
  Effect.gen(function* () {
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const before = was === undefined ? [] : incidentServices(estate, was)
    const joined = incidentServices(estate, now).filter((service) => !before.includes(service))
    if (joined.length === 0) return
    const at = yield* isoNow
    const { from } = incidentWindow(now, leadMinutes((yield* Configured).incidents), at)
    const notes = yield* Notes
    yield* Effect.forEach(
      runUp(estate, now, joined, from, at),
      ({ link, ...event }) =>
        notes.addIncidentEvent({
          ...event,
          incident: now.id,
          id: crypto.randomUUID(),
          recordedAt: at,
          source: "rebuilt",
          by: event.by ?? "Estate",
          ...(link === undefined ? {} : { link }),
        }),
      { discard: true },
    )
  }).pipe(Effect.catch((failure) => Effect.logWarning(`an incident's run-up could not be kept: ${failure.message}`)))
