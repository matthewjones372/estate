/**
 * Which kind of tool fills each part of an environment, from its section of the settings. Every part is a port: the
 * views read Estate's own state whichever kind filled it, so a kind added later is one more case here and its reader.
 */
import type { Settings, Sources } from "../settings"

/** What the services run on: their instances, jobs and debug switch. */
export const runtimeOf = (section: Sources): "kubernetes" | undefined =>
  section.kubernetes === undefined ? undefined : "kubernetes"

/** What chose each version and applied it; Flux reads through the cluster it runs in. */
export const deploysOf = (section: Sources): "flux" | undefined =>
  section.flux !== undefined && runtimeOf(section) === "kubernetes" ? "flux" : undefined

/** Where firing, pending and silenced alerts are read. */
export const alertsOf = (section: Sources): ReadonlyArray<"alertmanager" | "grafana" | "prometheus"> => [
  ...(section.alertmanager === undefined ? [] : ["alertmanager" as const]),
  ...(section.grafana === undefined ? [] : ["grafana" as const]),
  ...(section.prometheus === undefined ? [] : ["prometheus" as const]),
]

/** Where queries over a range are answered. */
export const metricsOf = (section: Sources): "prometheus" | undefined =>
  section.prometheus === undefined ? undefined : "prometheus"

/** Where each service's builds are read, for the whole estate rather than per environment. */
export const buildsOf = (settings: Settings): "github" | undefined =>
  settings.builds === undefined ? undefined : "github"
