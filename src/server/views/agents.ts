/** Each AI agent's health: its alerts, its pods where it names them, its failing runs, and its tokens against budget. */
import { type AgentState, tokens } from "../../shared/agents"
import type { Agent } from "../../shared/catalog"
import { compact } from "../../shared/compact"
import { costReasons } from "../../shared/costs"
import type { Health } from "../../shared/events"
import type { EnvironmentState } from "../state"

const hoursIn = { day: 24, month: 24 * 30 } as const

export const agentStateOf = (agent: Agent, environment: EnvironmentState): AgentState => {
  const usage = environment.metrics.value?.agents?.[agent.name] ?? {}
  const critical: string[] = []
  const attention: string[] = []
  for (const alert of environment.alerts.value ?? []) {
    if (alert.state !== "firing" || alert.labels["service"] !== agent.name) continue
    ;(alert.severity === "critical" ? critical : attention).push(`${alert.name} is firing`)
  }
  const pods = agent.runtime?.kubernetes === undefined ? undefined : environment.cluster.value?.pods[agent.name]
  if (pods !== undefined && environment.cluster.state === "ok") {
    const ready = pods.filter((pod) => pod.ready).length
    if (ready === 0) critical.push("no pod is ready")
    else if (ready < pods.length) attention.push(`${pods.length - ready} of ${pods.length} pods not ready`)
  }
  const runs = usage.runs?.now
  const failed = usage.errors?.now
  if (runs !== undefined && runs !== null && runs > 0 && failed !== undefined && failed !== null) {
    const share = failed / runs
    if (share > (agent.failing ?? 0.1)) attention.push(`${Math.round(share * 100)}% of runs failing`)
  }
  const { budget } = agent
  if (budget !== undefined) {
    const spent = usage.spent ?? undefined
    const hourly = usage.tokens?.now ?? undefined
    if (spent !== undefined && spent > budget.tokens)
      attention.push(`${tokens(spent)} tokens this ${budget.per}, over its ${tokens(budget.tokens)}`)
    else if (hourly !== undefined && hourly * hoursIn[budget.per] > budget.tokens)
      attention.push(
        `on course for ${tokens(hourly * hoursIn[budget.per])} tokens a ${budget.per}, over its ${tokens(budget.tokens)}`,
      )
  }
  attention.push(...costReasons(environment.costs.value?.[agent.name]))
  const read = environment.metrics.state === "ok" || environment.alerts.state === "ok"
  const health: Health =
    critical.length > 0 ? "critical" : attention.length > 0 ? "attention" : read ? "healthy" : "unknown"
  return compact({
    name: agent.name,
    health,
    reasons: health === "unknown" ? ["not read yet"] : [...critical, ...attention],
    usage,
    pods: pods?.map((pod) => ({ name: pod.name, ready: pod.ready })),
    cost: environment.costs.value?.[agent.name],
  })
}
