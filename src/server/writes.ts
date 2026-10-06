/**
 * What a route changes in the state after writing to a tool or the database, as a `Write`. One process applies it to
 * its own state; clustered, it goes to the runner that reads the estate, and every runner sees it on the next frame.
 */
import { Context, Effect, Layer, SubscriptionRef } from "effect"
import type { Write } from "./cluster/wire"
import { debugShown } from "./sources/debug"
import { holdSilence, holdUnsilence } from "./sources/held"
import { type EnvironmentState, Estate, type EstateState } from "./state"

/** Notes kept in the state, newest first. */
const kept = 500

const inEnvironment =
  (environment: string, update: (state: EnvironmentState) => EnvironmentState) =>
  (estate: EstateState): EstateState => {
    const current = estate.environments[environment]
    return current === undefined
      ? estate
      : { ...estate, environments: { ...estate.environments, [environment]: update(current) } }
  }

const withoutImpact = (estate: EstateState, alert: string) =>
  (estate.impacts ?? []).filter((each) => each.alert !== alert)

/** The state with a write shown, as the runner that made it would show it. */
export const applied = (write: Write): ((estate: EstateState) => EstateState) => {
  switch (write._tag) {
    case "NoteAdded":
      return (estate) => ({ ...estate, notes: [write.note, ...estate.notes].slice(0, kept) })
    case "NoteRemoved":
      return (estate) => ({ ...estate, notes: estate.notes.filter((each) => each.id !== write.id) })
    case "ImpactSet":
      return (estate) => ({ ...estate, impacts: [...withoutImpact(estate, write.impact.alert), write.impact] })
    case "ImpactCleared":
      return (estate) => ({ ...estate, impacts: withoutImpact(estate, write.alert) })
    case "Held":
      return inEnvironment(write.environment, (state) => {
        const alert = state.alerts.value?.find((each) => each.id === write.alert)
        return alert === undefined ? state : holdSilence(state, alert, write.silence, write.at)
      })
    case "Unheld":
      return inEnvironment(write.environment, (state) => holdUnsilence(state, write.id, write.at))
    case "ThreadKept":
      return (estate) => ({ ...estate, threads: [...(estate.threads ?? []), write.thread] })
    case "DebugShown":
      return inEnvironment(write.environment, (state) => debugShown(state, write.service, write.debug))
  }
}

export interface Writes {
  readonly apply: (write: Write) => Effect.Effect<void>
}
export const Writes = Context.Service<Writes>("estate/Writes")

/** Writes shown in this process's own state. */
export const localWrites = Layer.effect(Writes)(
  Effect.gen(function* () {
    const estate = yield* Estate
    return { apply: (write: Write) => SubscriptionRef.update(estate, applied(write)) }
  }),
)

/** A write shown wherever the estate is read. */
export const written = (write: Write): Effect.Effect<void, never, Writes> =>
  Effect.gen(function* () {
    const writes = yield* Writes
    yield* writes.apply(write)
  })
