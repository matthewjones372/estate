/** What each AI agent is doing: its usage over the last hour, its tokens spent, and the model it uses. */
import { Effect } from "effect"
import type { AgentUsage } from "../../shared/agents"
import type { Agent } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { Series } from "../../shared/events"
import type { Remote } from "../remote"
import type { EnvironmentState, Metrics } from "../state"
import { lastHour, type Ranges } from "./prometheus"

const series = ["runs", "errors", "p99", "tokens"] as const

const quietly = <A>(read: Effect.Effect<A, unknown, Remote>) =>
  read.pipe(
    Effect.option,
    Effect.map((found) => (found._tag === "Some" ? found.value : undefined)),
  )

/** The model in use, from the labels of the series its query gives: their values, several joined. */
export const modelOf = (labels: ReadonlyArray<Readonly<Record<string, string>>>): string | undefined => {
  const values = [
    ...new Set(
      labels.flatMap((each) =>
        Object.entries(each)
          .filter(([name]) => name !== "__name__")
          .map(([, value]) => value),
      ),
    ),
  ]
  return values.length === 0 ? undefined : values.toSorted().join(", ")
}

export const agentUsageOf = (ranges: Ranges, agent: Agent, now: number): Effect.Effect<AgentUsage, never, Remote> =>
  Effect.gen(function* () {
    const usage = agent.usage ?? {}
    const read = yield* Effect.forEach(
      series.flatMap((kind) => {
        const query = usage[kind]
        return query === undefined ? [] : [[kind, query] as const]
      }),
      ([kind, query]) =>
        Effect.map(quietly(ranges.range(query, lastHour, now)), (found): readonly [string, Series] => [
          kind,
          found ?? { now: null, points: [] },
        ]),
      { concurrency: ranges.concurrency ?? 3 },
    )
    const spent =
      usage.spent === undefined ? undefined : ((yield* quietly(ranges.range(usage.spent, lastHour, now)))?.now ?? null)
    const labels =
      usage.model === undefined || ranges.labels === undefined ? undefined : yield* quietly(ranges.labels(usage.model))
    return compact({ ...Object.fromEntries(read), spent, model: labels === undefined ? undefined : modelOf(labels) })
  })

/** After a read of the metrics: each agent's model change kept, when it was seen to change and from what. */
export const withModels = (
  before: EnvironmentState,
  after: EnvironmentState,
  metrics: Metrics,
  at: string,
): EnvironmentState => {
  const was = before.metrics.value?.agents ?? {}
  const agents = Object.fromEntries(
    Object.entries(metrics.agents ?? {}).map(([name, usage]) => {
      const previous = was[name]
      if (previous?.model !== undefined && usage.model !== undefined && previous.model !== usage.model)
        return [name, { ...usage, modelSince: at, modelWas: previous.model }]
      return [name, compact({ ...usage, modelSince: previous?.modelSince, modelWas: previous?.modelWas })]
    }),
  )
  return after.metrics.value === undefined
    ? after
    : { ...after, metrics: { ...after.metrics, value: { ...after.metrics.value, agents } } }
}
