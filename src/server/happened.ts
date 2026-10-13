/**
 * What a person, or Estate, did to a firing, kept as one of its events for its timeline. Like a reply in its Slack
 * thread, keeping it never fails what was done: a store that will not take it is a warning in the log.
 */
import { Effect, SubscriptionRef } from "effect"
import type { EventKind } from "../shared/timeline"
import { Notes } from "./notes"
import type { FiringKey } from "./notes-events"
import { Estate } from "./state"
import { isoNow } from "./time"

/** The firing an alert is now, in an environment, if it is firing there. */
export const firingNow = (environment: string, alert: string) =>
  Effect.gen(function* () {
    const { environments } = yield* SubscriptionRef.get(yield* Estate)
    const found = environments[environment]?.alerts.value?.find((each) => each.id === alert)
    return found === undefined ? undefined : { environment, alert, startsAt: found.startsAt }
  })

/** What an event may carry beyond its text: a link, and on an AI's answer whether it read logs. */
interface More {
  readonly link?: string
  readonly readLogs?: boolean
}

const kept = (firing: FiringKey, at: string, by: string, kind: EventKind, text: string, more: More = {}) =>
  Effect.gen(function* () {
    yield* (yield* Notes).addEvent({
      ...firing,
      id: crypto.randomUUID(),
      at,
      by,
      kind,
      text,
      ...(more.link === undefined ? {} : { link: more.link }),
      ...(more.readLogs === undefined ? {} : { readLogs: more.readLogs }),
    })
  }).pipe(Effect.catch((failure) => Effect.logWarning(`a firing's event could not be kept: ${failure.message}`)))

export const happened = (
  firing: FiringKey | undefined,
  by: string,
  kind: EventKind,
  text: string,
  more: More = {},
): Effect.Effect<void, never, Notes> =>
  firing === undefined ? Effect.void : Effect.flatMap(isoNow, (at) => kept(firing, at, by, kind, text, more))

/** What was done to an incident, on each of its firings at one time, so its page can show it once. */
export const happenedOnEach = (
  firings: ReadonlyArray<FiringKey>,
  by: string,
  kind: EventKind,
  text: string,
): Effect.Effect<void, never, Notes> =>
  Effect.flatMap(isoNow, (at) =>
    Effect.forEach(firings, (firing) => kept(firing, at, by, kind, text), { discard: true }),
  )
