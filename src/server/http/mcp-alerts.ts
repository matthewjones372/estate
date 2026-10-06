/**
 * MCP tools about what is happening: `alerts`, `alert_history`, `changes`, `errors`, `agents` and `around_alert`.
 * Each answers from the views the page uses, as the agent's role may see them, with a summary in words.
 */
import { Clock, Duration, Effect, Schema } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { AgentState } from "../../shared/agents"
import { AroundAlert } from "../../shared/around"
import { compact } from "../../shared/compact"
import { Alert, FeedItem } from "../../shared/events"
import { ErrorGroups } from "../../shared/log-events"
import { gatherAround } from "../around"
import { serviceLogs } from "../log-hub"
import { groupErrors } from "../sources/lines"
import type { EstateState } from "../state"
import { alertsView } from "../views/alerts"
import { feedView } from "../views/feed"
import { servicesView } from "../views/services"
import { EnvironmentArg, estateOf, NotFound, readsLogs, resolveEnv, withRequest } from "./mcp-shared"

const AlertArg = Schema.Struct({
  alert: Schema.String.annotate({ description: "the alert's id, or its name" }),
  environment: Schema.optionalKey(Schema.String),
})

const Alerts = Tool.make("alerts", {
  description:
    "What is firing, pending and silenced: each alert's impact, notes, silence, runbook and how often it fired before.",
  parameters: EnvironmentArg,
  success: Schema.Struct({ summary: Schema.String, environment: Schema.String, alerts: Schema.Array(Alert) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const Firing = Schema.Struct({
  startsAt: Schema.String,
  endsAt: Schema.optionalKey(Schema.String),
  silence: Schema.optionalKey(Schema.Struct({ by: Schema.String, reason: Schema.String })),
  notes: Schema.Array(Schema.Struct({ at: Schema.String, by: Schema.String, text: Schema.String })),
})

const AlertHistory = Tool.make("alert_history", {
  description:
    "An alert's earlier firings, newest first: how long each lasted, who silenced it and why, and the notes written then.",
  parameters: AlertArg,
  success: Schema.Struct({
    summary: Schema.String,
    environment: Schema.String,
    name: Schema.String,
    firings: Schema.Array(Firing),
  }),
  failure: NotFound,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const Changes = Tool.make("changes", {
  description: "What changed in an environment today, newest first: deploys, builds, alerts, silences, notes and jobs.",
  parameters: EnvironmentArg,
  success: Schema.Struct({ summary: Schema.String, environment: Schema.String, items: Schema.Array(FeedItem) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const Errors = Tool.make("errors", {
  description: "A service's errors over the last hour, six hours or day, grouped by message with numbers masked.",
  parameters: Schema.Struct({
    service: Schema.String,
    environment: Schema.optionalKey(Schema.String),
    range: Schema.optionalKey(Schema.Literals(["1h", "6h", "24h"])),
  }),
  success: Schema.Struct({ summary: Schema.String, environment: Schema.String, ...ErrorGroups.fields }),
  failure: NotFound,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const Agents = Tool.make("agents", {
  description: "Each AI agent: runs, failures, tokens against its budget, the model it uses and since when.",
  parameters: EnvironmentArg,
  success: Schema.Struct({ summary: Schema.String, environment: Schema.String, agents: Schema.Array(AgentState) }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const Around = Tool.make("around_alert", {
  description:
    "An alert's brief: what changed near it, what it depends on and how that is, its errors, its earlier firings and its runbook's text.",
  parameters: AlertArg,
  success: Schema.Struct({ summary: Schema.String, environment: Schema.String, around: AroundAlert }),
  failure: NotFound,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

export const alertToolkit = Toolkit.make(Alerts, AlertHistory, Changes, Errors, Agents, Around)

/** The alert asked for, by its id or its name, among those there now. */
const alertAsked = (estate: EstateState, environment: string, asked: string) =>
  alertsView(estate, environment, false).alerts.find((each) => each.id === asked || each.name === asked)

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

const ranges = { "1h": Duration.hours(1), "6h": Duration.hours(6), "24h": Duration.hours(24) } as const
const most = 2000

export const alertHandlers = alertToolkit.toLayer({
  alerts: ({ environment: asked }) =>
    Effect.map(estateOf, (estate) => {
      const environment = resolveEnv(estate, asked)
      const alerts = alertsView(estate, environment, false).alerts.map(({ chart: _, ...alert }) => alert)
      const firing = alerts.filter((alert) => alert.state === "firing")
      return {
        summary:
          alerts.length === 0
            ? `Nothing is firing in ${environment}.`
            : `${counted(firing.length, "alert")} firing in ${environment}: ${firing.map((alert) => alert.name).join(", ")}.`,
        environment,
        alerts,
      }
    }),
  alert_history: ({ alert: asked, environment: env }) =>
    Effect.gen(function* () {
      const estate = yield* estateOf
      const environment = resolveEnv(estate, env)
      const alert = alertAsked(estate, environment, asked)
      if (alert === undefined) return yield* new NotFound({ message: `${asked} is not firing in ${environment}` })
      const firings = (alert.history ?? []).map((firing) =>
        compact({ ...firing, notes: firing.notes.map(({ at, by, text }) => ({ at, by, text })) }),
      )
      return {
        summary:
          firings.length === 0
            ? `${alert.name} has not fired before, as far back as its firings are kept.`
            : `${alert.name} fired ${counted(firings.length, "time")} before; last ${firings[0]?.startsAt}.`,
        environment,
        name: alert.name,
        firings,
      }
    }),
  changes: ({ environment: asked }) =>
    Effect.gen(function* () {
      const estate = yield* estateOf
      const environment = resolveEnv(estate, asked)
      const { items } = feedView(estate, environment, yield* Clock.currentTimeMillis)
      return { summary: `${counted(items.length, "change")} in ${environment} today.`, environment, items }
    }),
  errors: ({ service, environment: asked, range = "1h" }) =>
    Effect.gen(function* () {
      const estate = yield* estateOf
      const environment = resolveEnv(estate, asked)
      if (!(yield* readsLogs)) return yield* new NotFound({ message: "logs are for operators here" })
      const logs = yield* withRequest(serviceLogs(environment, service))
      if (logs === undefined)
        return yield* new NotFound({ message: `${service} has no logs to read in ${environment}` })
      const now = yield* Clock.currentTimeMillis
      const read = yield* withRequest(Effect.result(logs.read(now - Duration.toMillis(ranges[range]), now, most)))
      if (read._tag === "Failure")
        return yield* new NotFound({ message: `the logs did not answer: ${read.failure.message}` })
      const groups = groupErrors(read.success, logs.isError)
      return {
        summary:
          groups.length === 0
            ? `No errors from ${service} in the last ${range}.`
            : `${counted(groups.length, "kind")} of error from ${service} in the last ${range}; most: "${groups[0]?.shape}".`,
        environment,
        from: logs.from,
        groups,
      }
    }),
  agents: ({ environment: asked }) =>
    Effect.map(estateOf, (estate) => {
      const environment = resolveEnv(estate, asked)
      const agents = servicesView(estate, environment).agents ?? []
      const troubled = agents.filter((agent) => agent.health === "attention" || agent.health === "critical")
      return {
        summary:
          troubled.length === 0
            ? `${counted(agents.length, "agent")} in ${environment}, none needing someone.`
            : `${troubled.map((agent) => `${agent.name}: ${agent.reasons.join("; ")}`).join(". ")}.`,
        environment,
        agents,
      }
    }),
  around_alert: ({ alert: asked, environment: env }) =>
    Effect.gen(function* () {
      const estate = yield* estateOf
      const environment = resolveEnv(estate, env)
      const alert = alertAsked(estate, environment, asked)
      const around =
        alert === undefined ? undefined : yield* withRequest(gatherAround(environment, alert.id, yield* readsLogs))
      if (around === undefined) return yield* new NotFound({ message: `${asked} is not firing in ${environment}` })
      return {
        summary: `${around.name}: ${counted(around.changed.length, "change")} near it, ${counted(around.depends.length, "neighbour")}, ${counted(around.before.length, "earlier firing")}.`,
        environment,
        around,
      }
    }),
})
