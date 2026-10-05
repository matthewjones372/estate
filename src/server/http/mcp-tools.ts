/**
 * MCP tools `estate_now`, `services`, and `service`: each answers from the views the page uses, with a short summary.
 */
import { Effect, Option, Schema, SubscriptionRef } from "effect"
import { Tool, Toolkit } from "effect/ai"
import { compact } from "../../shared/compact"
import { Estate, type EstateState } from "../state"
import { alertsView } from "../views/alerts"
import { catalogView } from "../views/catalog"
import { deploysView } from "../views/deploys"
import { nowView } from "../views/now"
import { servicesView } from "../views/services"

const EnvironmentArg = Schema.Struct({ environment: Schema.optionalKey(Schema.String) })
const ServiceArg = Schema.Struct({
  name: Schema.String,
  environment: Schema.optionalKey(Schema.String),
})

const resolveEnv = (estate: EstateState, asked: string | undefined): string =>
  asked ?? estate.catalog.environments[0]?.name ?? ""

/** The estate in the request's context: set while `/mcp` handles a call. */
const estateOf = Effect.gen(function* () {
  const ref = yield* Effect.serviceOption(Estate)
  if (Option.isNone(ref)) return yield* Effect.die("Estate is not available to this MCP tool")
  return yield* SubscriptionRef.get(ref.value)
})

const EstateNow = Tool.make("estate_now", {
  description: "An environment's headline: what needs someone, and why, worst first.",
  parameters: EnvironmentArg,
  success: Schema.Struct({
    summary: Schema.String,
    environment: Schema.String,
    tone: Schema.Literals(["healthy", "attention", "critical"]),
    kicker: Schema.String,
    top: Schema.String,
    bottom: Schema.String,
    lede: Schema.String,
    needs: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        kind: Schema.Literals(["service", "store", "job", "agent"]),
        health: Schema.Literals(["healthy", "attention", "critical", "unknown"]),
        reasons: Schema.Array(Schema.String),
      }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const Services = Tool.make("services", {
  description: "Every service, store, job and agent in an environment: health, reasons, version, owner, category.",
  parameters: EnvironmentArg,
  success: Schema.Struct({
    summary: Schema.String,
    environment: Schema.String,
    items: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        kind: Schema.Literals(["service", "store", "job", "agent"]),
        health: Schema.Literals(["healthy", "attention", "critical", "unknown"]),
        reasons: Schema.Array(Schema.String),
        version: Schema.optionalKey(Schema.String),
        owner: Schema.optionalKey(Schema.String),
        category: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const ServiceDetail = Schema.Struct({
  summary: Schema.String,
  environment: Schema.String,
  name: Schema.String,
  health: Schema.Literals(["healthy", "attention", "critical", "unknown"]),
  reasons: Schema.Array(Schema.String),
  version: Schema.optionalKey(Schema.String),
  owner: Schema.optionalKey(Schema.String),
  category: Schema.optionalKey(Schema.String),
  load: Schema.Unknown,
  pods: Schema.Unknown,
  debug: Schema.optionalKey(Schema.Unknown),
  links: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })),
  runbook: Schema.optionalKey(Schema.String),
  team: Schema.optionalKey(
    Schema.Struct({
      name: Schema.String,
      title: Schema.String,
      links: Schema.Array(Schema.Struct({ name: Schema.String, url: Schema.String })),
    }),
  ),
  deploy: Schema.optionalKey(Schema.Unknown),
  builds: Schema.Unknown,
  alerts: Schema.Array(Schema.Unknown),
})

const Service = Tool.make("service", {
  description: "One service: health, load over the last hour, pods, deploy and builds, alerts, debug, links, team.",
  parameters: ServiceArg,
  success: ServiceDetail,
  failure: Schema.String,
  failureMode: "return",
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

export const mcpToolkit = Toolkit.make(EstateNow, Services, Service)

const servicesList = (estate: EstateState, environment: string) => {
  const live = servicesView(estate, environment)
  const catalog = catalogView(estate.catalog, environment)
  const meta = (name: string) => catalog.services.find((each) => each.name === name)
  const storeMeta = (name: string) => catalog.stores?.find((each) => each.name === name)
  const jobMeta = (name: string) => catalog.jobs?.find((each) => each.name === name)
  const agentMeta = (name: string) => catalog.agents?.find((each) => each.name === name)
  return [
    ...live.services.map((each) =>
      compact({
        name: each.name,
        kind: "service" as const,
        health: each.health,
        reasons: each.reasons,
        version: each.version,
        owner: meta(each.name)?.owner,
        category: meta(each.name)?.category,
      }),
    ),
    ...(live.stores ?? []).map((each) =>
      compact({
        name: each.name,
        kind: "store" as const,
        health: each.health,
        reasons: each.reasons,
        category: storeMeta(each.name)?.category,
      }),
    ),
    ...(live.jobs ?? []).map((each) =>
      compact({
        name: each.name,
        kind: "job" as const,
        health: each.health,
        reasons: each.reasons,
        owner: jobMeta(each.name)?.owner,
        category: jobMeta(each.name)?.category,
      }),
    ),
    ...(live.agents ?? []).map((each) =>
      compact({
        name: each.name,
        kind: "agent" as const,
        health: each.health,
        reasons: each.reasons,
        owner: agentMeta(each.name)?.owner,
        category: agentMeta(each.name)?.category,
      }),
    ),
  ]
}

const serviceDetail = (estate: EstateState, environment: string, name: string) => {
  const live = servicesView(estate, environment).services.find((each) => each.name === name)
  const described = catalogView(estate.catalog, environment).services.find((each) => each.name === name)
  if (live === undefined || described === undefined) return undefined
  const alerts = alertsView(estate, environment, false).alerts.filter((alert) => alert.service === name)
  const deploy = deploysView(estate).services.find((each) => each.name === name)
  const here = deploy?.environments.find((each) => each.environment === environment)
  const team =
    described.owner === undefined
      ? undefined
      : catalogView(estate.catalog, environment).teams?.find((each) => each.name === described.owner)
  return compact({
    summary: `${name} is ${live.health}${live.reasons.length === 0 ? "" : `: ${live.reasons.join("; ")}`}`,
    environment,
    name,
    health: live.health,
    reasons: live.reasons,
    version: live.version,
    owner: described.owner,
    category: described.category,
    load: live.load,
    pods: live.pods,
    debug: live.debug,
    links: described.links,
    runbook: described.runbook,
    team: team === undefined ? undefined : { name: team.name, title: team.title, links: team.links },
    deploy: here,
    builds: deploy?.builds ?? [],
    alerts: alerts.map((alert) =>
      compact({
        id: alert.id,
        name: alert.name,
        state: alert.state,
        severity: alert.severity,
        summary: alert.summary,
        startsAt: alert.startsAt,
      }),
    ),
  })
}

export const mcpHandlers = mcpToolkit.toLayer({
  estate_now: ({ environment: asked }) =>
    Effect.gen(function* () {
      const estate = yield* estateOf
      const environment = resolveEnv(estate, asked)
      const now = nowView(estate, environment)
      return {
        summary: now.summary,
        environment: now.environment,
        tone: now.tone,
        kicker: now.kicker,
        top: now.top,
        bottom: now.bottom,
        lede: now.lede,
        needs: now.needs,
      }
    }),
  services: ({ environment: asked }) =>
    Effect.gen(function* () {
      const estate = yield* estateOf
      const environment = resolveEnv(estate, asked)
      const items = servicesList(estate, environment)
      const needing = items.filter((each) => each.health === "attention" || each.health === "critical")
      return {
        summary:
          needing.length === 0
            ? `${items.length} in ${environment}, nothing needs someone.`
            : `${needing.length} of ${items.length} in ${environment} need someone.`,
        environment,
        items,
      }
    }),
  service: ({ name, environment: asked }) =>
    Effect.gen(function* () {
      const estate = yield* estateOf
      const environment = resolveEnv(estate, asked)
      const detail = serviceDetail(estate, environment, name)
      if (detail === undefined) return yield* Effect.fail(`there is no service ${name} in ${environment}`)
      return detail
    }),
})
