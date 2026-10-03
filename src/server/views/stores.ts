/** A store's health in an environment, with the reasons in plain words, from its alerts and its preset's thresholds. */
import type { Catalog, Store } from "../../shared/catalog"
import type { Health } from "../../shared/events"
import { reasonsOf } from "../../shared/stores"
import type { EnvironmentState } from "../state"

export const storesIn = (catalog: Catalog, environment: string): ReadonlyArray<Store> =>
  (catalog.stores ?? []).filter((store) => store.environments.includes(environment))

const storeLabels = ["store", "database", "instance"]

/** The store an alert is about: named by its `store`, `database` or `instance` label. */
export const storeOf = (labels: Readonly<Record<string, string>>, stores: ReadonlyArray<Store>): string | undefined => {
  const names = new Set(stores.map((store) => store.name))
  return storeLabels.map((label) => labels[label]).find((value) => value !== undefined && names.has(value))
}

export const storeHealthOf = (
  store: Store,
  environment: EnvironmentState,
  stores: ReadonlyArray<Store>,
): { readonly health: Health; readonly reasons: ReadonlyArray<string> } => {
  const firing = (environment.alerts.value ?? []).filter(
    (alert) => alert.state === "firing" && storeOf(alert.labels, stores) === store.name,
  )
  const critical = firing.filter((alert) => alert.severity === "critical").map((alert) => `${alert.name} is firing`)
  const warned = firing.filter((alert) => alert.severity !== "critical").map((alert) => `${alert.name} is firing`)
  const readings = environment.metrics.value?.stores?.[store.name]
  const now = Object.fromEntries((readings ?? []).map((reading) => [reading.key, reading.series.now]))
  const attention = [...warned, ...reasonsOf(store, now)]
  if (critical.length > 0) return { health: "critical", reasons: [...critical, ...attention] }
  if (attention.length > 0) return { health: "attention", reasons: attention }
  return readings === undefined && environment.alerts.state !== "ok"
    ? { health: "unknown", reasons: ["no source has answered"] }
    : { health: "healthy", reasons: [] }
}
