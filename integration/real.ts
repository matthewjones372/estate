/**
 * The tools themselves, for the integration suites: each started from its published image by Testcontainers and
 * thrown away afterwards, and Estate's own readers run against them over real HTTP.
 */
import { Effect } from "effect"
import { liveRemote, type Remote } from "../src/server/remote"

/** Runs one of Estate's effects against the real tools, as the server would. */
export const real = <A, E>(effect: Effect.Effect<A, E, Remote>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(liveRemote)))

/** An answer as text for a failure, its Maps as their entries rather than JSON's `{}`. */
const shown = (answer: unknown) =>
  JSON.stringify(answer, (_, value) => (value instanceof Map ? Object.fromEntries(value) : value)) ?? String(answer)

/** Asks until `found` holds of the answer, as a person waits for a rule to fire: at most `seconds`. */
export const eventually = async <A>(ask: () => Promise<A>, found: (answer: A) => boolean, seconds = 90): Promise<A> => {
  const until = Date.now() + seconds * 1000
  for (;;) {
    const answer = await ask().catch((error: unknown) => {
      if (Date.now() > until) throw error
      return undefined
    })
    if (answer !== undefined && found(answer)) return answer
    if (Date.now() > until) throw new Error(`not found within ${seconds} s: ${shown(answer).slice(0, 400)}`)
    await Bun.sleep(1000)
  }
}

export const urlOf = (container: { getHost: () => string; getMappedPort: (port: number) => number }, port: number) =>
  `http://${container.getHost()}:${container.getMappedPort(port)}`
