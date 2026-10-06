/**
 * A firing's Slack thread, kept up: whoever writes a note, silences it or ends a silence is replied in it under their
 * name, and so is its end. A reply that fails is logged; it never fails what the person did on the page.
 */
import { Effect, SubscriptionRef } from "effect"
import type { Remote } from "./remote"
import { post, type SlackSettings } from "./sources/slack"
import { Estate } from "./state"

/** Which firing: an alert in an environment, by its start, or by the one firing now. */
export interface Told {
  readonly environment: string
  readonly alert: string
  readonly startsAt?: string
}

export const replyInThread = (
  slack: SlackSettings | undefined,
  told: Told,
  text: string,
): Effect.Effect<void, never, Estate | Remote> =>
  Effect.gen(function* () {
    if (slack === undefined) return
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const startsAt =
      told.startsAt ??
      estate.environments[told.environment]?.alerts.value?.find((alert) => alert.id === told.alert)?.startsAt
    const thread = estate.threads?.find(
      (each) => each.environment === told.environment && each.alert === told.alert && each.startsAt === startsAt,
    )
    if (thread === undefined) return
    yield* post(slack, thread.channel, text, thread.ts).pipe(
      Effect.catch((failure) => Effect.logWarning(`a reply in Slack's thread failed: ${failure.message}`)),
    )
  })

/** "15 min", "1 hour", "2 hours", "1 day": how long, as a thread says it. */
export const lasting = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return hours === 1 ? "1 hour" : `${hours} hours`
  const days = Math.round(hours / 24)
  return days === 1 ? "1 day" : `${days} days`
}
