/**
 * What every `/mcp` tool shares: the estate as the request finds it, the environment it was asked about, the agent
 * asking, and the error for something that is not there. Services come from the request's context, read when a tool
 * is called, so the toolkit's layer needs nothing to be built.
 */
import { Context, Effect, FileSystem, Option, Schema, SubscriptionRef } from "effect"
import { Remote } from "../remote"
import { Configured, type Settings } from "../settings"
import { Estate, type EstateState } from "../state"

/** The agent a token named, and the role it reads as. */
export interface McpCaller {
  readonly name: string
  readonly role: "viewer" | "operator"
}
export const McpCaller = Context.Service<McpCaller>("estate/McpCaller")

/** What a tool answers when what it was asked about is not in the estate, or not for this agent. */
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { message: Schema.String }) {}

export const EnvironmentArg = Schema.Struct({ environment: Schema.optionalKey(Schema.String) })

export const resolveEnv = (estate: EstateState, asked: string | undefined): string =>
  asked ?? estate.catalog.environments[0]?.name ?? ""

/** A service the request carries; one missing is a defect in how `/mcp` was put together, not the agent's error. */
const fromRequest = <I, S>(service: Context.Key<I, S>) =>
  Effect.flatMap(Effect.serviceOption(service), (found) =>
    Option.isSome(found) ? Effect.succeed(found.value) : Effect.die(`${service.key} is not available to /mcp`),
  )

export const estateOf = Effect.flatMap(fromRequest(Estate), SubscriptionRef.get)

const settingsOf: Effect.Effect<Settings> = fromRequest(Configured)

/** The agent asking; a call with none in context reads as a viewer, the least it could be. */
const callerOf: Effect.Effect<McpCaller> = Effect.map(Effect.serviceOption(McpCaller), (found) =>
  Option.getOrElse(found, () => ({ name: "an agent", role: "viewer" as const })),
)

/** Whether the agent asking may read logs, as a person of its role may on the page. */
export const readsLogs = Effect.gen(function* () {
  const { auth } = yield* settingsOf
  const caller = yield* callerOf
  return auth.logs !== "operator" || caller.role === "operator"
})

/** Runs `effect` with what it reads from the request: the estate, the settings, the tools and the files. */
export const withRequest = <A, E>(
  effect: Effect.Effect<A, E, Estate | Configured | Remote | FileSystem.FileSystem>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const estate = yield* fromRequest(Estate)
    const settings = yield* fromRequest(Configured)
    const remote = yield* fromRequest(Remote)
    const files = yield* fromRequest(FileSystem.FileSystem)
    return yield* effect.pipe(
      Effect.provideService(Estate, estate),
      Effect.provideService(Configured, settings),
      Effect.provideService(Remote, remote),
      Effect.provideService(FileSystem.FileSystem, files),
    )
  })
