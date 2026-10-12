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

export const happened = (
  firing: FiringKey | undefined,
  by: string,
  kind: EventKind,
  text: string,
  link?: string,
): Effect.Effect<void, never, Notes> =>
  firing === undefined
    ? Effect.void
    : Effect.gen(function* () {
        yield* (yield* Notes).addEvent({
          ...firing,
          id: crypto.randomUUID(),
          at: yield* isoNow,
          by,
          kind,
          text,
          ...(link === undefined ? {} : { link }),
        })
      }).pipe(Effect.catch((failure) => Effect.logWarning(`a firing's event could not be kept: ${failure.message}`)))
