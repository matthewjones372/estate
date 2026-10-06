/**
 * How often Ask AI may be asked, so a busy morning cannot run up a bill: one answer an alert a minute, and a budget
 * of tokens a day across every alert. Held in a `Ref`, per Estate process.
 */
import { Clock, Context, Data, Duration, Effect, Layer, Ref } from "effect"

const AskLimited = Data.TaggedError("AskLimited")<{ readonly message: string }>
type AskLimited = InstanceType<typeof AskLimited>

export interface AskLimits {
  /** Takes an alert's turn, or fails saying why it must wait. */
  readonly take: (alert: string) => Effect.Effect<void, AskLimited>
  /** Counts what an answer cost against the day's budget. */
  readonly spend: (tokens: number) => Effect.Effect<void>
  /** Gives back an alert's turn when its ask failed, so it can be asked again at once. */
  readonly giveBack: (alert: string) => Effect.Effect<void>
}
export const AskLimits = Context.Service<AskLimits>("estate/AskLimits")

/** Tokens a day unless `ai.budget.tokensPerDay` says otherwise. */
const tokensPerDay = 500_000
const turn = Duration.toMillis(Duration.minutes(1))

interface Held {
  readonly asked: Readonly<Record<string, number>>
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
        asked: Object.fromEntries(Object.entries(state.asked).filter(([, at]) => now - at < turn)),
        day: dayOf(now),
        spent: state.day === dayOf(now) ? state.spent : 0,
      })
      return {
        take: (alert) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const refusal = yield* Ref.modify(held, (was): readonly [string | undefined, Held] => {
              const state = today(was, now)
              if (state.spent >= budget)
                return [`Ask AI has used today's ${budget.toLocaleString("en-GB")} tokens`, state]
              if (state.asked[alert] !== undefined) return ["this alert was asked about less than a minute ago", state]
              return [undefined, { ...state, asked: { ...state.asked, [alert]: now } }]
            })
            if (refusal !== undefined) return yield* new AskLimited({ message: refusal })
          }),
        spend: (tokens) =>
          Effect.flatMap(Clock.currentTimeMillis, (now) =>
            Ref.update(held, (was) => {
              const state = today(was, now)
              return { ...state, spent: state.spent + tokens }
            }),
          ),
        giveBack: (alert) =>
          Ref.update(held, (state) => ({
            ...state,
            asked: Object.fromEntries(Object.entries(state.asked).filter(([key]) => key !== alert)),
          })),
      }
    }),
  )
