/** Instants in Estate's words: ISO text, made with `DateTime` and moved by a `Duration`, read from the `Clock`. */
import { Clock, DateTime, Duration, Effect } from "effect"

/** An instant, given in milliseconds since the epoch, a `Date` or ISO text, as ISO text. */
export const iso = (at: number | Date | string): string => DateTime.formatIso(DateTime.makeUnsafe(at))

/** An instant that may not be there, as ISO text. */
export const isoOf = (at: Date | undefined): string | undefined => (at === undefined ? undefined : iso(at))

/** Now, as ISO text. */
export const isoNow: Effect.Effect<string> = Effect.map(Clock.currentTimeMillis, iso)

/** `by` after the instant `at`, in milliseconds. */
export const after = (at: number, by: Duration.Input): number => at + Duration.toMillis(by)

/** `by` before the instant `at`, in milliseconds. */
export const before = (at: number, by: Duration.Input): number => at - Duration.toMillis(by)

/** What a source says when it has no time for something: the epoch. */
export const epoch = iso(0)
