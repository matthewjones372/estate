/**
 * Firing alerts as one problem reads: those linked into the same incident as one group, then two or more on the
 * same service or store as one, the rest on their own; worst first, then longest firing.
 */
import type { Alert } from "../shared/events"
import { rankOf, worstFirst } from "./parts/AlertLine"
import { pathOf } from "./route"

export type Grouped =
  | { readonly kind: "alert"; readonly alert: Alert }
  | {
      readonly kind: "incident" | "service" | "store"
      readonly key: string
      readonly title: string
      /** Where its title links. */
      readonly to: string
      /** Worst first, then longest firing. */
      readonly alerts: ReadonlyArray<Alert>
      /** When the incident was opened; a service's or a store's group, when its first alert fired. */
      readonly since: string
    }

/** By incident everywhere; by service or store too where alerts from many are together, as on the overview. */
export type GroupBy = "incident" | "incident and service"

type Group = Exclude<Grouped, { readonly kind: "alert" }>

const together = <T>(alerts: ReadonlyArray<Alert>, keyOf: (alert: Alert) => T | undefined) => {
  const found = new Map<T, Array<Alert>>()
  for (const alert of alerts) {
    const key = keyOf(alert)
    if (key !== undefined) found.set(key, [...(found.get(key) ?? []), alert])
  }
  return [...found.entries()].filter(([, held]) => held.length > 1)
}

const longest = (alerts: ReadonlyArray<Alert>) =>
  alerts.reduce((first, alert) => (alert.startsAt < first ? alert.startsAt : first), alerts[0]?.startsAt ?? "")

const firstOf = (entry: Grouped) => (entry.kind === "alert" ? entry.alert : entry.alerts[0])

/** Worst severity first, then the one firing longest. */
const order = (a: Grouped, b: Grouped) => {
  const [worstA, worstB] = [firstOf(a), firstOf(b)]
  const rank = (worstA === undefined ? 0 : rankOf(worstA)) - (worstB === undefined ? 0 : rankOf(worstB))
  const started = (entry: Grouped) => (entry.kind === "alert" ? entry.alert.startsAt : longest(entry.alerts))
  return rank || Date.parse(started(a)) - Date.parse(started(b))
}

const whereOf = (alert: Alert) =>
  alert.service !== undefined
    ? `service ${alert.service}`
    : alert.store === undefined
      ? undefined
      : `store ${alert.store}`

export const groupedOf = (alerts: ReadonlyArray<Alert>, by: GroupBy): ReadonlyArray<Grouped> => {
  const incidents: ReadonlyArray<Group> = together(alerts, (alert) => alert.incident?.id).map(([key, held]) => {
    const incident = held[0]?.incident
    return {
      kind: "incident",
      key: `incident ${key}`,
      title: incident?.title ?? key,
      to: pathOf({ page: "incident", id: key }),
      alerts: [...held].sort(worstFirst),
      since: incident?.openedAt ?? longest(held),
    }
  })
  // An alert is in one group at most: its incident's, if it has one.
  const places: ReadonlyArray<Group> =
    by === "incident"
      ? []
      : together(
          alerts.filter((alert) => alert.incident === undefined),
          whereOf,
        ).map(([key, held]) => {
          const store = held[0]?.service === undefined
          const name = (store ? held[0]?.store : held[0]?.service) ?? key
          return {
            kind: store ? "store" : "service",
            key,
            title: name,
            to: pathOf(store ? { page: "store", name } : { page: "service", name }),
            alerts: [...held].sort(worstFirst),
            since: longest(held),
          }
        })
  const grouped = new Set([...incidents, ...places].flatMap((group) => group.alerts))
  const single = alerts.filter((alert) => !grouped.has(alert)).map((alert) => ({ kind: "alert", alert }) as const)
  return [...incidents, ...places, ...single].sort(order)
}
