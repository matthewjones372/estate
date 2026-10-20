/**
 * One reader of a service's lines per environment, shared by everyone watching it, and stopped a few seconds after
 * the last of them leaves. It asks for what is new every two seconds and keeps the last batches for whoever joins.
 */
import {
  Cache,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  type FileSystem,
  Layer,
  PubSub,
  RcMap,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect"
import type { LogBatch } from "../shared/log-events"
import type { Remote } from "./remote"
import { Configured } from "./settings"
import { type ErrorsRead, logsFor, type ServiceLogs } from "./sources/logs"
import type { Failure } from "./sources/run"
import { Estate } from "./state"
import { inEnvironment } from "./views/catalog"

export interface LogHub {
  readonly watch: (environment: string, service: string) => Effect.Effect<Stream.Stream<LogBatch>, never, Scope.Scope>
  /**
   * A service's errors over the last `range`, one read a minute however many pages ask, so that a crowd on one
   * service page during an incident is one read; undefined where it has no logs.
   */
  readonly errorsOver: (
    environment: string,
    service: string,
    range: Duration.Duration,
  ) => Effect.Effect<ErrorsOver | undefined, Failure, Remote | FileSystem.FileSystem | Estate | Configured>
}

interface ErrorsOver {
  readonly logs: ServiceLogs
  readonly read: ErrorsRead
}

/** The most errors one read takes in. */
export const errorsMost = 2000
export const LogHub = Context.Service<LogHub>("estate/LogHub")

const every = Duration.seconds(2)
const firstLook = Duration.minutes(15)
const most = 200

/** A service's lines in an environment as the catalog and the settings say now, if it has any to read. */
export const serviceLogs = (environment: string, service: string) =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const found = catalog.environments.find((each) => each.name === environment)
    const described = inEnvironment(catalog, environment).find((each) => each.name === service)
    return found === undefined || described === undefined
      ? undefined
      : logsFor(settings.sources[found.sources] ?? {}, described)
  })

const sent = (since: number, ...batches: ReadonlyArray<LogBatch>) => [since, batches] as const

/** What is new every two seconds, from a quarter of an hour before `start`: a batch each time lines came, or a read failed. */
const batchesOf = (logs: ServiceLogs, start: number) =>
  Stream.tick(every).pipe(
    Stream.mapAccumEffect(
      () => start - Duration.toMillis(firstLook),
      (since) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const read = yield* Effect.result(logs.read(since, now, most + 1))
          if (read._tag === "Failure") return sent(since, { lines: [], skipped: false, failed: read.failure.message })
          const lines = read.success.slice(-most)
          const last = lines.at(-1)
          return last === undefined
            ? sent(since)
            : sent(Date.parse(last.at) + 1, { lines, skipped: read.success.length > most })
        }),
    ),
  )

export const logHubLayer = Layer.effect(LogHub)(
  Effect.gen(function* () {
    const readers = yield* RcMap.make({
      lookup: (key: string) =>
        Effect.gen(function* () {
          const [environment = "", service = ""] = key.split("\u0000")
          const batches = yield* PubSub.unbounded<LogBatch>({ replay: 25 })
          const logs = yield* serviceLogs(environment, service)
          if (logs !== undefined)
            yield* Effect.forkScoped(Stream.runIntoPubSub(batchesOf(logs, yield* Clock.currentTimeMillis), batches))
          return batches
        }),
      idleTimeToLive: "5 seconds",
    })
    const errors = yield* Cache.makeWith(
      (key: string) =>
        Effect.gen(function* () {
          const [environment = "", service = "", millis = "0"] = key.split("\u0000")
          const logs = yield* serviceLogs(environment, service)
          if (logs === undefined) return undefined
          const now = yield* Clock.currentTimeMillis
          return { logs, read: yield* logs.errors(now - Number(millis), now, errorsMost) }
        }),
      // A failed read is not kept, so the next ask tries again.
      { capacity: 256, timeToLive: (exit) => (Exit.isSuccess(exit) ? "1 minute" : 0), requireServicesAt: "lookup" },
    )
    return {
      watch: (environment: string, service: string) =>
        Effect.map(RcMap.get(readers, `${environment}\u0000${service}`), Stream.fromPubSub),
      errorsOver: (environment, service, range) =>
        Cache.get(errors, `${environment}\u0000${service}\u0000${Duration.toMillis(range)}`),
    }
  }),
)
