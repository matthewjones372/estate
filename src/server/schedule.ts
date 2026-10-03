/** Something done now and then every so often, for as long as Estate runs. */
import { Duration, Effect, Schedule } from "effect"

export const forEver = <E, R>(
  once: Effect.Effect<unknown, E, R>,
  spacing: Duration.Input,
): Effect.Effect<never, E, R> => once.pipe(Effect.repeat(Schedule.spaced(spacing)), Effect.andThen(Effect.never))

/** Tries again sooner at first, then less often, never waiting more than a minute: for a dependency that is down. */
export const backOff = Schedule.exponential("1 second").pipe(
  Schedule.modifyDelay(({ duration }) => Effect.succeed(Duration.min(duration, Duration.minutes(1)))),
)
