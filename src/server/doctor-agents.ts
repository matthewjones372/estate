/** The doctor's lines for AI agents: each one's usage as its queries read it, and its runs where Langfuse has them. */
import { Effect } from "effect"
import type { Agent } from "../shared/catalog"
import { amount, finding } from "./doctor-finding"
import type { Sources } from "./settings"
import { agentUsageOf } from "./sources/agents"
import { agentRuns } from "./sources/langfuse"
import type { Ranges } from "./sources/prometheus"

/** Each agent's usage as its queries read it, and its runs where Langfuse traces them. */
export const agentsFindings = (
  section: Sources,
  ranges: Ranges | undefined,
  agents: ReadonlyArray<Agent>,
  now: number,
) =>
  Effect.gen(function* () {
    if (agents.length === 0) return []
    const usage =
      ranges === undefined
        ? { part: "agents", ok: false, says: "no metrics source to read agents' usage from" }
        : yield* finding(
            "agents",
            Effect.forEach(agents, (agent) =>
              Effect.map(agentUsageOf(ranges, agent, now), (read) => [agent, read] as const),
            ),
            (read) =>
              read
                .map(([agent, each]) =>
                  [
                    `${agent.name}: ${each.model ?? (agent.usage?.model === undefined ? "no model query" : "its model query gave no labels")}`,
                    `runs ${amount(each.runs?.now === null || each.runs?.now === undefined ? undefined : each.runs.now * 60)}/min`,
                    `tokens ${amount(each.tokens?.now)}/h`,
                    ...(agent.budget === undefined
                      ? []
                      : [`spent ${amount(each.spent)} of ${agent.budget.tokens} a ${agent.budget.per}`]),
                  ].join(", "),
                )
                .join("; "),
          )
    const traced = agents.flatMap((agent) =>
      agent.runs === undefined ? [] : [[agent, agent.runs.langfuse.name] as const],
    )
    const { langfuse } = section
    if (traced.length === 0) return [usage]
    if (langfuse === undefined)
      return [
        usage,
        { part: "runs", ok: false, says: "agents name Langfuse traces, and this environment has no langfuse" },
      ]
    const runs = yield* finding(
      "runs",
      Effect.forEach(traced, ([agent, name]) =>
        Effect.map(agentRuns(langfuse, name, 5), (read) => [agent.name, read] as const),
      ),
      (read) =>
        read
          .map(([name, each]) =>
            each.length === 0
              ? `${name}: no traces by its name`
              : `${name}: ${each.length} recent, ${each.filter((run) => run.failed).length} failed`,
          )
          .join("; "),
    )
    return [usage, runs]
  })
