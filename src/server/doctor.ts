/**
 * `estate doctor`: each environment's sources asked once, with the readers the server runs, and what they said put
 * as a line per part: what answered, how much, and what does not fit the catalog, so whoever points Estate at their
 * team's tools sees why a lane is empty before they look at the page.
 */
import { Clock, Effect } from "effect"
import { type Catalog, ecsOf, kubernetesOf, type Service } from "../shared/catalog"
import { costLine } from "../shared/costs"
import { makeAwsJson } from "./aws/json"
import { agentsFindings } from "./doctor-agents"
import { codeFinding } from "./doctor-code"
import { backstageFinding, discoverFinding } from "./doctor-discover"
import { amount, type Finding, finding, type Needs } from "./doctor-finding"
import type { Remote } from "./remote"
import type { Settings, Sources } from "./settings"
import { readAlerts } from "./sources/alerts"
import { readArgo } from "./sources/argo"
import { readBuilds } from "./sources/builds"
import { cloudwatchApi, readAlarms } from "./sources/cloudwatch"
import { readCluster } from "./sources/cluster"
import { costsIn } from "./sources/costs"
import { alertsBeside } from "./sources/datadog"
import { datadogQueryOf } from "./sources/datadog-logs"
import { ecsApi, readEcsDeploys, readEcsWorkloads } from "./sources/ecs"
import { matchOf } from "./sources/elastic"
import { intervalsOf } from "./sources/every"
import { readDeploys } from "./sources/flux"
import { readHarnessDeploys } from "./sources/harness"
import { clusterOf } from "./sources/kubernetes"
import { logsFor } from "./sources/logs"
import { loadOf } from "./sources/metrics"
import { alertsOf, deploysOf, metricsOf, runtimeOf } from "./sources/ports"
import { lastHour, type Ranges, thresholdOf } from "./sources/prometheus"
import { rangesIn } from "./sources/ranges"
import type { Failure } from "./sources/run"
import type { Chosen, SourcedAlert, Workloads } from "./state"
import { agentsIn, inEnvironment } from "./views/catalog"
import { serviceOf } from "./views/health"
import { storeOf, storesIn } from "./views/stores"

const alertsFinding = (
  section: Sources,
  catalog: Catalog,
  environment: string,
  alarms?: Effect.Effect<ReadonlyArray<SourcedAlert>, Failure, Remote>,
) =>
  finding("alerts", readAlerts(section, alarms), (alerts) => {
    const services = inEnvironment(catalog, environment)
    const stores = storesIn(catalog, environment)
    const firing = alerts.filter((alert) => alert.state === "firing").length
    const pending = alerts.filter((alert) => alert.state === "pending").length
    const silenced = alerts.filter((alert) => alert.state === "silenced").length
    const lost = alerts.filter(
      (alert) => serviceOf(alert.labels, services) === undefined && storeOf(alert.labels, stores) === undefined,
    )
    const labels = [...new Set(lost.flatMap((alert) => Object.keys(alert.labels)))].sort()
    return [
      `${alertsOf(section).join(", ")}: ${firing} firing, ${pending} pending, ${silenced} silenced`,
      `${alerts.length - lost.length} about a service or store`,
      ...(lost.length === 0
        ? []
        : [
            `${lost.length} about none (${lost.map((alert) => alert.name).join(", ")}; their labels: ${labels.join(", ")})`,
          ]),
    ].join("; ")
  })

const chartsFinding = (
  ranges: Ranges,
  alerts: Effect.Effect<
    ReadonlyArray<{ readonly name: string; readonly state: string; readonly expression?: string }>,
    Failure,
    Needs
  >,
) =>
  finding("charts", Effect.all([ranges.rules, alerts]), ([rules, all]) => {
    const firing = all.filter((alert) => alert.state === "firing")
    const charted = firing.filter((alert) => thresholdOf(alert.expression ?? rules.get(alert.name) ?? "") !== undefined)
    const missing = firing.filter((alert) => !charted.includes(alert)).map((alert) => alert.name)
    return `${charted.length} of ${firing.length} firing alerts have a threshold to chart against${missing.length === 0 ? "" : ` (not ${missing.join(", ")})`}`
  })

const metricsFinding = (ranges: Ranges, kind: string, services: ReadonlyArray<Service>, now: number) =>
  finding(
    "metrics",
    Effect.andThen(
      ranges.rules,
      Effect.forEach(services, (service) =>
        Effect.map(loadOf(ranges, service, lastHour, now), (load) => [service, load] as const),
      ),
    ),
    (loads) => {
      const said = loads
        .filter(([service]) => service.load !== undefined)
        .map(
          ([service, load]) =>
            `${service.name} ${(["requests", "errors", "p99"] as const)
              .filter((kind) => service.load?.[kind] !== undefined)
              .map((each) => `${each} ${amount(load[each]?.now)}`)
              .join(", ")}`,
        )
      return `${kind}: ${said.length === 0 ? "no service names a load query" : said.join("; ")}`
    },
  )

const workloadsSaid = (services: ReadonlyArray<Service>, workloads: Workloads) =>
  services
    .filter((service) => (kubernetesOf(service) ?? ecsOf(service)) !== undefined)
    .map((service) => {
      const pods = workloads.pods[service.name] ?? []
      return pods.length === 0
        ? `${service.name} 0 running: check its workloads in the catalog`
        : `${service.name} ${pods.filter((pod) => pod.ready).length}/${pods.length} ready`
    })
    .join("; ") || "no service names where it runs"

const deploysSaid = (kind: string, chosen: Readonly<Record<string, Chosen>>) =>
  `${kind}: ${
    Object.entries(chosen)
      .map(([name, each]) => `${name} ${each.version}${each.stalled === undefined ? "" : ` stalled: ${each.stalled}`}`)
      .join("; ") || "no service names how it is deployed"
  }`

const logsFinding = (section: Sources, services: ReadonlyArray<Service>, now: number) =>
  Effect.forEach(services, (service) => {
    const logs = logsFor(section, service)
    if (logs === undefined) return Effect.succeed(undefined)
    return finding("logs", logs.read(now - 15 * 60_000, now, 200), (lines) => {
      if (lines.length > 0) return `${logs.from}: ${service.name} ${lines.length} lines in 15 min`
      const hint =
        logs.from === "Elasticsearch"
          ? `nothing matches ${Object.entries(matchOf(service))
              .map(([field, value]) => `${field}=${value}`)
              .join(", ")}; set logs.elastic.match for ${service.name}`
          : logs.from === "Loki"
            ? `nothing matches its selector; set logs.selector for ${service.name}`
            : logs.from === "Datadog" && section.datadog !== undefined
              ? `nothing matches ${datadogQueryOf(section.datadog, service)}; set logs.selector for ${service.name}`
              : "its pods logged nothing"
      return `${logs.from}: ${service.name} 0 lines in 15 min: ${hint}`
    })
  }).pipe(Effect.map((found) => found.filter((each): each is Finding => each !== undefined)))

export interface Report {
  readonly environment: string
  readonly findings: ReadonlyArray<Finding>
}

/** One environment's parts, each asked once. */
const examine = (settings: Settings, catalog: Catalog, environment: string, sources: string) =>
  Effect.gen(function* () {
    const section = settings.sources[sources] ?? {}
    const services = inEnvironment(catalog, environment)
    const now = yield* Clock.currentTimeMillis
    const { aws, kubernetes, argo } = section
    const ecs = aws === undefined ? undefined : yield* makeAwsJson(ecsApi, aws.region, aws.endpoint)
    const cloudwatch = aws === undefined ? undefined : yield* makeAwsJson(cloudwatchApi, aws.region, aws.endpoint)
    const alarms = alertsBeside(cloudwatch === undefined ? undefined : readAlarms(cloudwatch), section.datadog)
    const ranges = yield* rangesIn(section)
    const findings: Array<Finding> = [{ part: "every", ok: true, says: intervalsOf(section) }]
    if (alertsOf(section).length > 0) findings.push(yield* alertsFinding(section, catalog, environment, alarms))
    if (ranges !== undefined) {
      findings.push(yield* chartsFinding(ranges, readAlerts(section, alarms)))
      findings.push(yield* metricsFinding(ranges, metricsOf(section) ?? "", services, now))
    }
    const cluster = runtimeOf(section) === "kubernetes" && kubernetes !== undefined ? clusterOf(kubernetes) : undefined
    if (cluster !== undefined)
      findings.push(
        yield* finding(
          "cluster",
          Effect.flatMap(cluster, (each) => readCluster(each, services)),
          (found) => workloadsSaid(services, found),
        ),
      )
    if (ecs !== undefined && runtimeOf(section) === "ecs")
      findings.push(
        yield* finding("cluster", readEcsWorkloads(ecs, services), (found) => workloadsSaid(services, found)),
      )
    const deploys = deploysOf(section)
    if (deploys === "argo" && argo !== undefined)
      findings.push(yield* finding("deploys", readArgo(argo, services), (found) => deploysSaid("argo", found)))
    if (deploys === "harness" && section.harness !== undefined)
      findings.push(
        yield* finding("deploys", readHarnessDeploys(section.harness, services, environment), (found) =>
          deploysSaid("harness", found),
        ),
      )
    if (deploys === "flux" && cluster !== undefined)
      findings.push(
        yield* finding(
          "deploys",
          Effect.flatMap(cluster, (each) => readDeploys(each, services)),
          (found) => deploysSaid("flux", found),
        ),
      )
    if (deploys === "ecs" && ecs !== undefined)
      findings.push(
        yield* finding("deploys", readEcsDeploys(ecs, services, new Map()), (found) => deploysSaid("ecs", found)),
      )
    const costs = yield* costsIn(section)
    if (costs !== undefined)
      findings.push(
        yield* finding("costs", costs(catalog, environment), (found) => {
          const entries = Object.entries(found)
          return entries.length === 0
            ? "nothing in this environment is in the bill: check each entry's cost tag, or its namespace for OpenCost"
            : entries.map(([name, cost]) => `${name} ${costLine(cost) || "no spend"} (${cost.from})`).join("; ")
        }),
      )
    const discovered = yield* discoverFinding(section, catalog, environment)
    if (discovered !== undefined) findings.push(discovered)
    findings.push(...(yield* logsFinding(section, services, now)))
    findings.push(...(yield* agentsFindings(section, ranges, agentsIn(catalog, environment), now)))
    return { environment, findings }
  })

/** Every environment's report, and the builds', which are read for the whole estate. */
export const doctor = (settings: Settings, catalog: Catalog): Effect.Effect<ReadonlyArray<Report>, never, Needs> =>
  Effect.gen(function* () {
    const reports = yield* Effect.forEach(catalog.environments, (each) =>
      examine(settings, catalog, each.name, each.sources),
    )
    const backstage = yield* backstageFinding(settings.backstage, catalog)
    const code = yield* codeFinding(settings.code, catalog)
    const wide = [backstage, code].filter((each) => each !== undefined)
    const { builds } = settings
    if (builds === undefined)
      return wide.length === 0 ? reports : [...reports, { environment: "every environment", findings: wide }]
    const read = yield* finding(
      "builds",
      readBuilds(builds, catalog.services),
      (found) =>
        found
          .filter(([, each]) => each.length > 0)
          .map(
            ([name, each]) =>
              `${name} ${each.length}${each[0]?.status === "failure" ? `, last failed${each[0].job === undefined ? "" : ` at ${each[0].job}`}` : ""}`,
          )
          .join("; ") || "no service's builds were found",
    )
    return [...reports, { environment: "every environment", findings: [read, ...wide] }]
  })

/** The reports as text, a part a line, and whether every part answered. */
export const printed = (reports: ReadonlyArray<Report>): { readonly text: string; readonly ok: boolean } => ({
  text: reports
    .map(
      (report) =>
        `${report.environment}\n${report.findings
          .map((each) => `  ${each.part.padEnd(8)} ${each.ok ? "ok  " : "fail"}  ${each.says}`)
          .join("\n")}`,
    )
    .join("\n\n"),
  ok: reports.every((report) => report.findings.every((each) => each.ok)),
})
