/**
 * Which kind of tool fills each part of an environment, from its section of the settings. Every part is a port: the
 * views read Estate's own state whichever kind filled it, so a kind added later is one more case here and its reader.
 */
import type { Settings, Sources } from "../settings"
import { prometheusOf } from "./grafana"

/** What the services run on: their instances, jobs and debug switch. An environment runs on one of them. */
export const runtimeOf = (section: Sources): "kubernetes" | "ecs" | undefined => {
  if (section.kubernetes !== undefined) return "kubernetes"
  return section.aws === undefined ? undefined : "ecs"
}

/**
 * What chose each version and applied it: Argo CD through its own API, Flux through the cluster it runs in, or ECS's
 * own deployments.
 */
export const deploysOf = (section: Sources): "argo" | "flux" | "ecs" | undefined => {
  if (section.argo !== undefined) return "argo"
  if (runtimeOf(section) === "ecs") return "ecs"
  return section.flux !== undefined && runtimeOf(section) === "kubernetes" ? "flux" : undefined
}

/** Where firing, pending and silenced alerts are read. */
export const alertsOf = (
  section: Sources,
): ReadonlyArray<"alertmanager" | "grafana" | "prometheus" | "cloudwatch" | "datadog"> => [
  ...(section.alertmanager === undefined ? [] : ["alertmanager" as const]),
  ...(section.grafana === undefined ? [] : ["grafana" as const]),
  ...(prometheusOf(section) === undefined ? [] : ["prometheus" as const]),
  ...(section.aws === undefined ? [] : ["cloudwatch" as const]),
  ...(section.datadog === undefined ? [] : ["datadog" as const]),
]

/** Where queries over a range are answered: Prometheus, or else Datadog, or else CloudWatch. */
export const metricsOf = (section: Sources): "prometheus" | "datadog" | "cloudwatch" | undefined => {
  if (prometheusOf(section) !== undefined) return "prometheus"
  if (section.datadog !== undefined) return "datadog"
  return section.aws === undefined ? undefined : "cloudwatch"
}

/** Where each service's builds are read, for the whole estate rather than per environment. */
export const buildsOf = (settings: Settings): ReadonlyArray<"github" | "gitlab" | "jenkins" | "teamcity"> => [
  ...(settings.builds?.github === undefined ? [] : ["github" as const]),
  ...(settings.builds?.gitlab === undefined ? [] : ["gitlab" as const]),
  ...(settings.builds?.jenkins === undefined ? [] : ["jenkins" as const]),
  ...(settings.builds?.teamcity === undefined ? [] : ["teamcity" as const]),
]
