/**
 * A source read on its own schedule for one environment. What it reads becomes its part of the state; when it does
 * not answer, its part keeps what it last read, marked failing with the words it failed with, and the rest carries on.
 */
import { Clock, type Duration, Effect, Schedule } from "effect"
import { type EnvironmentState, type Estate, type Part, updateEnvironment } from "../state"

export interface Failure {
  readonly message: string
}

type Parts = "metrics" | "alerts" | "cluster" | "deploys"
type ValueOf<K extends Parts> = NonNullable<EnvironmentState[K]["value"]>

/** The part after a read: what it read, or what it last read with why it failed. */
export const afterRead = <A>(part: Part<A>, read: { readonly value: A } | Failure, at: string): Part<A> =>
  "value" in read
    ? { state: "ok", value: read.value, answeredAt: at }
    : {
        state: "failing",
        message: read.message,
        ...(part.answeredAt === undefined ? {} : { answeredAt: part.answeredAt }),
        ...(part.value === undefined ? {} : { value: part.value }),
      }

/** Reads `read` now and every `every`, for as long as Estate runs; `also` sees each read with the state before it. */
export const runSource = <K extends Parts, R>(
  environment: string,
  part: K,
  every: Duration.Input,
  read: Effect.Effect<ValueOf<K>, Failure, R>,
  also: (before: EnvironmentState, after: EnvironmentState, value: ValueOf<K>, at: string) => EnvironmentState = (
    _,
    after,
  ) => after,
): Effect.Effect<never, never, R | Estate> => {
  const once = Effect.gen(function* () {
    const result = yield* Effect.result(read)
    const at = new Date(yield* Clock.currentTimeMillis).toISOString()
    yield* updateEnvironment(environment, (state) => {
      const next = {
        ...state,
        [part]: afterRead(
          state[part] as Part<ValueOf<K>>,
          result._tag === "Success" ? { value: result.success } : result.failure,
          at,
        ),
      }
      return result._tag === "Success" ? also(state, next, result.success, at) : next
    })
  })
  return once.pipe(Effect.repeat(Schedule.spaced(every)), Effect.andThen(Effect.never))
}
