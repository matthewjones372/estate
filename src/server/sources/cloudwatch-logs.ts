/**
 * A service's lines from CloudWatch Logs: FilterLogEvents over its log group, kept to the streams of its container as
 * ECS's awslogs driver names them (`prefix/container/task-id`), each stream's task id as the line's pod. The group and
 * prefix come from the catalog, or else from the task definition.
 */
import { Clock, Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { ecsOf, type Service } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import { type AwsCallError, type AwsJson, makeAwsJson } from "../aws/json"
import type { Sources } from "../settings"
import { iso } from "../time"
import { type Container, containersOf, ecsApi } from "./ecs"
import { type Line, lineOf } from "./lines"
import { type Failure, SourceFailure } from "./run"

const cloudwatchLogsApi = {
  service: "logs",
  target: "Logs_20140328",
  version: "1.1",
  name: "CloudWatch Logs",
} as const

/** Where a service's lines are: a log group, and the prefix of its streams, if they are not the whole group. */
export interface LogGroup {
  readonly group: string
  readonly prefix?: string
}

/** How far behind the last line seen each read starts: CloudWatch can make a line searchable seconds after its time. */
export const cloudwatchOverlap = 10_000

/** The most events one FilterLogEvents page holds, and the most pages one read follows. */
const page = 10_000
const pages = 5
/** What a read too busy to follow keeps to: its last minute. */
const busy = 60_000
const callsPerSecond = 4

const Events = Schema.Struct({
  events: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        logStreamName: Schema.optionalKey(Schema.String),
        timestamp: Schema.Number,
        message: Schema.String,
      }),
    ),
  ),
  nextToken: Schema.optionalKey(Schema.String),
})
type Event = NonNullable<typeof Events.Type.events>[number]

/** The group and prefix a service's container gives the awslogs driver, under the catalog's own where it names them. */
export const logGroupFrom = (
  service: Service,
  containers: ReadonlyArray<Pick<Container, "name" | "essential" | "logConfiguration">>,
): LogGroup | undefined => {
  const named = service.logs?.cloudwatch
  const awslogs = containers.filter((container) => container.logConfiguration?.logDriver === "awslogs")
  const container =
    named?.container === undefined
      ? (awslogs.find((each) => each.name === service.name && each.essential !== false) ?? awslogs[0])
      : awslogs.find((each) => each.name === named.container)
  const options = container?.logConfiguration?.options ?? {}
  const group = named?.group ?? options["awslogs-group"]
  const prefix = options["awslogs-stream-prefix"]
  if (group === undefined) return undefined
  return compact({
    group,
    prefix:
      named?.prefix ?? (prefix === undefined || container === undefined ? undefined : `${prefix}/${container.name}/`),
  })
}

/**
 * The account's FilterLogEvents calls, shared by every reader in a region: AWS allows 5 to 25 a second an account,
 * not raised on request and shared with the console, so Estate takes its share in turn and waits rather than be refused.
 */
export interface CloudwatchBudget {
  /** Waits for this reader's turn among `perSecond` calls a second in `region`. */
  readonly take: (region: string, perSecond: number) => Effect.Effect<void>
  /** Leaves `region` alone for a while, after CloudWatch said it was asked too often. */
  readonly backOff: (region: string) => Effect.Effect<void>
}
export const CloudwatchBudget = Context.Service<CloudwatchBudget>("estate/CloudwatchBudget")

const pause = 5_000

export const cloudwatchBudgetLayer = Layer.effect(CloudwatchBudget)(
  Effect.gen(function* () {
    /** When each region's next call may be made. */
    const next = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
    return {
      take: (region, perSecond) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const turn = yield* Ref.modify(next, (held) => {
            const at = Math.max(now, held.get(region) ?? 0)
            return [at, new Map(held).set(region, at + 1000 / perSecond)] as const
          })
          if (turn > now) yield* Effect.sleep(turn - now)
        }),
      backOff: (region) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          Ref.update(next, (held) => new Map(held).set(region, Math.max(now, held.get(region) ?? 0) + pause)),
        ),
    }
  }),
)

/** A reader's turn and its back-off, or none where nothing shares the budget (a test, `estate doctor`). */
interface Pace {
  readonly take: Effect.Effect<void>
  readonly backOff: Effect.Effect<void>
}

const lineFrom =
  (where: LogGroup) =>
  (event: Event): Line => {
    const stream = event.logStreamName
    const task =
      stream === undefined || where.prefix === undefined || !stream.startsWith(where.prefix)
        ? stream
        : stream.slice(where.prefix.length)
    return lineOf(iso(event.timestamp), event.message, task)
  }

const cloudwatchLines = (
  logs: AwsJson,
  where: LogGroup,
  from: number,
  to: number,
  limit: number,
  pace: Pace = { take: Effect.void, backOff: Effect.void },
): Effect.Effect<ReadonlyArray<Line>, Failure> => {
  const ask = (start: number, nextToken: string | undefined) =>
    pace.take.pipe(
      Effect.andThen(
        logs(
          "FilterLogEvents",
          compact({
            logGroupIdentifier: where.group,
            logStreamNamePrefix: where.prefix,
            startTime: Math.floor(start),
            endTime: Math.floor(to),
            limit: page,
            nextToken,
          }),
        ),
      ),
      Effect.flatMap(Schema.decodeUnknownEffect(Events)),
      Effect.catchTag("AwsCallError", (error: AwsCallError) =>
        Effect.andThen(
          error.type === "ThrottlingException" ? pace.backOff : Effect.void,
          new SourceFailure({ message: `CloudWatch Logs ${error.message} (${where.group})` }),
        ),
      ),
      Effect.mapError((error) =>
        error._tag === "SchemaError"
          ? new SourceFailure({ message: "CloudWatch Logs answered in a shape Estate does not know" })
          : error,
      ),
    )
  /** The events from `start`, page by page as CloudWatch answers them, oldest first; `more` when some were left. */
  const follow = (start: number) =>
    Effect.gen(function* () {
      const events: Event[] = []
      let token: string | undefined
      for (let read = 0; read < pages; read++) {
        const answered = yield* ask(start, token)
        events.push(...(answered.events ?? []))
        token = answered.nextToken
        if (token === undefined) return { events, more: false }
      }
      return { events, more: true }
    })
  return Effect.gen(function* () {
    const followed = yield* follow(from)
    // CloudWatch answers oldest first, so a window too busy to follow is read again from its last minute.
    const { events } = followed.more && to - busy > from ? yield* follow(to - busy) : followed
    return events
      .map(lineFrom(where))
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-limit)
  })
}

type Aws = NonNullable<Sources["aws"]>
type CloudwatchLogs = NonNullable<Sources["cloudwatchLogs"]>

/**
 * A reader of a service's lines from CloudWatch Logs, or nothing for a service neither on ECS nor naming its group.
 * Its callers and its group are found at its first read and kept while it is read, as a group moves only with a new
 * task definition.
 */
export const cloudwatchReader = (aws: Aws, settings: CloudwatchLogs, service: Service) => {
  const runtime = ecsOf(service)
  const named = service.logs?.cloudwatch
  if (runtime === undefined && named?.group === undefined) return undefined
  let found: { readonly logs: AwsJson; readonly where: LogGroup } | undefined
  const reach = Effect.gen(function* () {
    if (found !== undefined) return found
    const logs = yield* makeAwsJson(cloudwatchLogsApi, aws.region, aws.endpoint)
    const containers =
      runtime === undefined || (named?.group !== undefined && named.prefix !== undefined)
        ? []
        : yield* containersOf(yield* makeAwsJson(ecsApi, aws.region, aws.endpoint), runtime)
    const where = logGroupFrom(service, containers)
    if (where === undefined)
      return yield* new SourceFailure({
        message: `${service.name}'s task definition logs through no awslogs container; set logs.cloudwatch.group`,
      })
    found = { logs, where }
    return found
  })
  return (from: number, to: number, limit: number) =>
    Effect.gen(function* () {
      const { logs, where } = yield* reach
      const budget = yield* Effect.serviceOption(CloudwatchBudget)
      const perSecond = settings.callsPerSecond ?? callsPerSecond
      const pace = Option.match(budget, {
        onNone: () => undefined,
        onSome: (shared) => ({ take: shared.take(aws.region, perSecond), backOff: shared.backOff(aws.region) }),
      })
      return yield* cloudwatchLines(logs, where, from, to, limit, pace)
    })
}
