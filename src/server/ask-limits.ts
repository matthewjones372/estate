/**
 * How often Ask AI may be asked, so a busy morning cannot run up a bill: one answer an alert a minute, and a budget
 * of tokens a day across every alert. Whoever asks again within the minute shares that answer, waiting for it while
 * it is being asked, rather than being refused. Held in a `Ref`, per Estate process.
 */
import { Clock, Context, Data, Deferred, Duration, Effect, Layer, Ref } from "effect"
import type { AskAnswer } from "../shared/ask"
import type { SummaryAnswer } from "../shared/summary"

/** What a turn answers: Ask AI about an alert, or Summarise an incident, which share the day's budget. */
type Answer = AskAnswer | SummaryAnswer

const AskLimited = Data.TaggedError("AskLimited")<{ readonly message: string }>
type AskLimited = InstanceType<typeof AskLimited>

export interface AskLimits {
  /** Takes an alert's turn, or fails saying why it must wait. */
  readonly take: (alert: string) => Effect.Effect<void, AskLimited>
  /** The answer of an alert's turn, waited for while it is asked: undefined once it has passed, or if it failed. */
  readonly shared: (alert: string) => Effect.Effect<Answer | undefined>
  /** Keeps an alert's answer for whoever asks within its minute. */
  readonly keep: (alert: string, answer: Answer) => Effect.Effect<void>
  /** Counts what an answer cost against the day's budget. */
  readonly spend: (tokens: number) => Effect.Effect<void>
  /** Gives back an alert's turn when its ask failed, so it can be asked again at once. */
  readonly giveBack: (alert: string) => Effect.Effect<void>
}
export const AskLimits = Context.Service<AskLimits>("estate/AskLimits")

/** Tokens a day unless `ai.budget.tokensPerDay` says otherwise. */
const tokensPerDay = 500_000
const turn = Duration.toMillis(Duration.minutes(1))

interface Turn {
  readonly at: number
  readonly answer: Deferred.Deferred<Answer | undefined>
}

interface Held {
  readonly asked: Readonly<Record<string, Turn>>
  readonly day: string
  readonly spent: number
}

const dayOf = (at: number) => new Date(at).toISOString().slice(0, 10)

export const liveAskLimits = (budget = tokensPerDay): Layer.Layer<AskLimits> =>
  Layer.effect(AskLimits)(
    Effect.gen(function* () {
      const held = yield* Ref.make<Held>({ asked: {}, day: "", spent: 0 })
      // A new day starts with the budget whole; turns older than a minute are forgotten.
      const today = (state: Held, now: number): Held => ({
        asked: Object.fromEntries(Object.entries(state.asked).filter(([, taken]) => now - taken.at < turn)),
        day: dayOf(now),
        spent: state.day === dayOf(now) ? state.spent : 0,
      })
      return {
        take: (alert) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const answer = yield* Deferred.make<Answer | undefined>()
            const refusal = yield* Ref.modify(held, (was): readonly [string | undefined, Held] => {
              const state = today(was, now)
              if (state.spent >= budget)
                return [`Ask AI has used today's ${budget.toLocaleString("en-GB")} tokens`, state]
              if (state.asked[alert] !== undefined) return ["this alert was asked about less than a minute ago", state]
              return [undefined, { ...state, asked: { ...state.asked, [alert]: { at: now, answer } } }]
            })
            if (refusal !== undefined) return yield* new AskLimited({ message: refusal })
          }),
        shared: (alert) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const taken = today(yield* Ref.get(held), now).asked[alert]
            return taken === undefined ? undefined : yield* Deferred.await(taken.answer)
          }),
        keep: (alert, answer) =>
          Effect.flatMap(Ref.get(held), (state) => {
            const taken = state.asked[alert]
            return taken === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(taken.answer, answer))
          }),
        spend: (tokens) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Ref.update(held, (was) => {
              const state = today(was, now)
              return { ...state, spent: state.spent + tokens }
            }),
          ),
        // Whoever was waiting on the turn is told it failed, and asks again for themselves.
        giveBack: (alert) =>
          Effect.flatMap(
            Ref.modify(held, (state): readonly [Turn | undefined, Held] => [
              state.asked[alert],
              { ...state, asked: Object.fromEntries(Object.entries(state.asked).filter(([key]) => key !== alert)) },
            ]),
            (taken) => (taken === undefined ? Effect.void : Effect.asVoid(Deferred.succeed(taken.answer, undefined))),
          ),
      }
    }),
  )
