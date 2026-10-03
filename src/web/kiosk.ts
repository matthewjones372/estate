/** What a screen on the wall shows, and when: worked out apart from the page, so each rule can be tested. */
import type { Alert, Events, Health, ServiceState } from "../shared/events"

const rank: Readonly<Record<Health, number>> = { critical: 0, attention: 1, unknown: 2, healthy: 3 }

/** The services a screen shows: a team's, by the catalog's owner, or all of them; worst first, then by name. */
export const tilesOf = (events: Partial<Events>, team: string | undefined): ReadonlyArray<ServiceState> => {
  const owned = new Set(
    (events.catalog?.services ?? [])
      .filter((service) => team === undefined || service.owner === team)
      .map((service) => service.name),
  )
  return (events.services?.services ?? [])
    .filter((service) => owned.has(service.name))
    .toSorted((a, b) => rank[a.health] - rank[b.health] || a.name.localeCompare(b.name))
}

/** The alerts firing that a screen shows: a team's are about its services; without a team, every one. */
export const firingOf = (events: Partial<Events>, team: string | undefined): ReadonlyArray<Alert> => {
  const shown = new Set(tilesOf(events, team).map((service) => service.name))
  return (events.alerts?.alerts ?? []).filter(
    (alert) =>
      alert.state === "firing" && (team === undefined || (alert.service !== undefined && shown.has(alert.service))),
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
