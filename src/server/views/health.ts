/** A service's health in an environment, with the reasons in plain words, from what its sources said. */
import type { Service } from "../../shared/catalog"
import type { Health } from "../../shared/events"
import type { EnvironmentState, SourcedAlert } from "../state"

const rank: Readonly<Record<Health, number>> = { healthy: 0, unknown: 1, attention: 2, critical: 3 }

export const worst = (healths: ReadonlyArray<Health>): Health =>
  healths.reduce<Health>((worse, health) => (rank[health] > rank[worse] ? health : worse), "healthy")

const serviceLabels = ["service", "app", "app_kubernetes_io_name", "job", "container"]

/** The service an alert is about: named by one of its labels, or the only service in its namespace. */
export const serviceOf = (
  labels: Readonly<Record<string, string>>,
  services: ReadonlyArray<Service>,
): string | undefined => {
  const names = new Set(services.map((service) => service.name))
  for (const label of serviceLabels) {
    const value = labels[label]
    if (value !== undefined && names.has(value)) return value
  }
  const { namespace } = labels
  const inNamespace = services.filter((service) => service.kubernetes?.namespace === namespace)
  return namespace !== undefined && inNamespace.length === 1 ? inNamespace[0]?.name : undefined
}

const alertsOf = (
  service: Service,
  alerts: ReadonlyArray<SourcedAlert>,
  services: ReadonlyArray<Service>,
): ReadonlyArray<SourcedAlert> => alerts.filter((alert) => serviceOf(alert.labels, services) === service.name)

export const healthOf = (
  service: Service,
  environment: EnvironmentState,
  services: ReadonlyArray<Service>,
): { readonly health: Health; readonly reasons: ReadonlyArray<string> } => {
  const critical: string[] = []
  const attention: string[] = []
  const firing = alertsOf(service, environment.alerts.value ?? [], services).filter((alert) => alert.state === "firing")
  for (const alert of firing) (alert.severity === "critical" ? critical : attention).push(`${alert.name} is firing`)

  const pods = environment.cluster.value?.pods[service.name]
  if (service.kubernetes !== undefined && environment.cluster.state === "ok" && pods !== undefined) {
    const ready = pods.filter((pod) => pod.ready).length
    if (ready === 0) critical.push("no pod is ready")
    else if (ready < pods.length) attention.push(`${pods.length - ready} of ${pods.length} pods not ready`)
  }
  const stalled = environment.deploys.value?.[service.name]?.stalled
  if (stalled !== undefined) attention.push(`deploy stalled: ${stalled}`)

  if (critical.length > 0) return { health: "critical", reasons: [...critical, ...attention] }
  if (attention.length > 0) return { health: "attention", reasons: attention }
  const heard = environment.alerts.state === "ok" || environment.cluster.state === "ok"
  return heard ? { health: "healthy", reasons: [] } : { health: "unknown", reasons: ["no source has answered"] }
}
