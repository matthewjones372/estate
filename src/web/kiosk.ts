/** What a screen on the wall shows, and when: worked out apart from the page, so each rule can be tested. */
import type { Alert, Events, Health, ServiceState } from "../shared/events"

const rank: Readonly<Record<Health, number>> = { critical: 0, attention: 1, unknown: 2, healthy: 3 }

/** What a screen is narrowed to: a team, by the catalog's owner, and a category. */
export interface Narrowed {
  readonly team?: string | undefined
  readonly category?: string | undefined
}

/** The services a screen shows: those it is narrowed to, or all of them; worst first, then by name. */
export const tilesOf = (events: Partial<Events>, narrowed: Narrowed): ReadonlyArray<ServiceState> => {
  const { team, category } = narrowed
  const owned = new Set(
    (events.catalog?.services ?? [])
      .filter((service) => team === undefined || service.owner === team)
      .filter((service) => category === undefined || service.category === category)
      .map((service) => service.name),
  )
  return (events.services?.services ?? [])
    .filter((service) => owned.has(service.name))
    .toSorted((a, b) => rank[a.health] - rank[b.health] || a.name.localeCompare(b.name))
}

/** The alerts firing that a screen shows: when narrowed, those about its services; otherwise every one. */
export const firingOf = (events: Partial<Events>, narrowed: Narrowed): ReadonlyArray<Alert> => {
  const shown = new Set(tilesOf(events, narrowed).map((service) => service.name))
  const everything = narrowed.team === undefined && narrowed.category === undefined
  return (events.alerts?.alerts ?? []).filter(
    (alert) => alert.state === "firing" && (everything || (alert.service !== undefined && shown.has(alert.service))),
  )
}

/** How long an environment stays: its turn, or twice that while something there is firing. */
export const turnOf = (every: number, firing: number): number => every * 1000 * (firing > 0 ? 2 : 1)

/** The environment after `current`, round again to the first. */
export const nextOf = (environments: ReadonlyArray<string>, current: string): string | undefined =>
  environments[(environments.indexOf(current) + 1) % environments.length]

const quiet = 2 * 60_000

/** Whether a screen should say it is not being updated: nothing heard for two minutes. */
export const staleSince = (heardAt: number | undefined, opened: number, now: number): number | undefined => {
  const last = heardAt ?? opened
  return now - last >= quiet ? last : undefined
}
