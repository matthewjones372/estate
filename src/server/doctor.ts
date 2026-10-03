/**
 * `estate doctor`: each environment's sources asked once, with the readers the server runs, and what they said put
 * as a line per part: what answered, how much, and what does not fit the catalog, so whoever points Estate at their
 * team's tools sees why a lane is empty before they look at the page.
 */
import { Clock, Effect, type FileSystem } from "effect"
import { type Catalog, ecsOf, kubernetesOf, type Service } from "../shared/catalog"
import { makeAwsJson } from "./aws/json"
import type { Remote } from "./remote"
import type { Settings, Sources } from "./settings"
import { readAlerts } from "./sources/alerts"
import { readArgo } from "./sources/argo"
import { readBuilds } from "./sources/builds"
import { cloudwatchApi, cloudwatchRanges, readAlarms } from "./sources/cloudwatch"
import { readCluster } from "./sources/cluster"
import { ecsApi, readEcsDeploys, readEcsWorkloads } from "./sources/ecs"
import { matchOf } from "./sources/elastic"
import { readDeploys } from "./sources/flux"
import { grafanaRules } from "./sources/grafana"
import { clusterOf } from "./sources/kubernetes"
import { logsFor } from "./sources/logs"
import { loadOf } from "./sources/metrics"
import { alertsOf, deploysOf, metricsOf, runtimeOf } from "./sources/ports"
import { lastHour, prometheusRanges, type Ranges, thresholdOf } from "./sources/prometheus"
import type { Failure } from "./sources/run"
import type { Chosen, SourcedAlert, Workloads } from "./state"
import { inEnvironment } from "./views/catalog"
import { serviceOf } from "./views/health"
import { storeOf, storesIn } from "./views/stores"

interface Finding {
  readonly part: string
  readonly ok: boolean
  readonly says: string
}

export interface Report {
  readonly environment: string
  readonly findings: ReadonlyArray<Finding>
}

type Needs = Remote | FileSystem.FileSystem

const amount = (value: number | null | undefined) =>
  value === null || value === undefined ? "no data" : String(Math.round(value * 100) / 100)

/** The part's line: what `read` found, put by `say`, or its failure in the tool's words. */
const finding = <A>(part: string, read: Effect.Effect<A, Failure, Needs>, say: (found: A) => string) =>
  read.pipe(
    Effect.map((found): Finding => ({ part, ok: true, says: say(found) })),
    Effect.catch((failure) => Effect.succeed<Finding>({ part, ok: false, says: failure.message })),
  )

const alertsFinding = (
  section: Sources,
  catalog: Catalog,
  environment: string,
  alarms?: Effect.Effect<ReadonlyArray<SourcedAlert>, Failure>,
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
            : "its pods logged nothing"
      return `${logs.from}: ${service.name} 0 lines in 15 min: ${hint}`
    })
  }).pipe(Effect.map((found) => found.filter((each): each is Finding => each !== undefined)))

/** One environment's parts, each asked once. */
const examine = (settings: Settings, catalog: Catalog, environment: string, sources: string) =>
  Effect.gen(function* () {
    const section = settings.sources[sources] ?? {}
    const services = inEnvironment(catalog, environment)
    const now = yield* Clock.currentTimeMillis
    const { aws, prometheus, grafana, kubernetes, argo } = section
    const ecs = aws === undefined ? undefined : yield* makeAwsJson(ecsApi, aws.region, aws.endpoint)
    const cloudwatch = aws === undefined ? undefined : yield* makeAwsJson(cloudwatchApi, aws.region, aws.endpoint)
    const alarms = cloudwatch === undefined ? undefined : readAlarms(cloudwatch)
    const ranges =
      metricsOf(section) === "prometheus" && prometheus !== undefined
        ? prometheusRanges(prometheus.url, grafana === undefined ? undefined : grafanaRules(grafana))
        : cloudwatch === undefined
          ? undefined
          : cloudwatchRanges(cloudwatch)
    const findings: Array<Finding> = []
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
    findings.push(...(yield* logsFinding(section, services, now)))
    return { environment, findings }
  })

/** Every environment's report, and the builds', which are read for the whole estate. */
export const doctor = (settings: Settings, catalog: Catalog): Effect.Effect<ReadonlyArray<Report>, never, Needs> =>
  Effect.gen(function* () {
    const reports = yield* Effect.forEach(catalog.environments, (each) =>
      examine(settings, catalog, each.name, each.sources),
    )
    const { builds } = settings
    if (builds === undefined) return reports
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
    return [...reports, { environment: "every environment", findings: [read] }]
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
