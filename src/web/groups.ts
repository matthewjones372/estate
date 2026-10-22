/** The overview's lanes in groups: one a category, in the order the catalog first names each, the rest last. */
import type { CatalogEvent, Health } from "../shared/events"

type Services = CatalogEvent["services"]
type Stores = NonNullable<CatalogEvent["stores"]>
type Jobs = NonNullable<CatalogEvent["jobs"]>
type Agents = NonNullable<CatalogEvent["agents"]>

export interface Group {
  /** The category, or none when the catalog names no categories at all. */
  readonly title?: string
  readonly services: Services
  readonly stores: Stores
  readonly jobs: Jobs
  readonly agents: Agents
}

export const otherwise = "Everything else"

export const groupsOf = (catalog: CatalogEvent | undefined): ReadonlyArray<Group> => {
  const services = catalog?.services ?? []
  const stores = catalog?.stores ?? []
  const jobs = catalog?.jobs ?? []
  const agents = catalog?.agents ?? []
  const named = [...services, ...stores, ...jobs, ...agents].flatMap((each) =>
    each.category === undefined ? [] : [each.category],
  )
  if (named.length === 0) return [{ services, stores, jobs, agents }]
  const titles = [...new Set(named)]
  const groups = titles.map((title) => ({
    title,
    services: services.filter((service) => service.category === title),
    stores: stores.filter((store) => store.category === title),
    jobs: jobs.filter((job) => job.category === title),
    agents: agents.filter((agent) => agent.category === title),
  }))
  const rest = {
    title: otherwise,
    services: services.filter((service) => service.category === undefined),
    stores: stores.filter((store) => store.category === undefined),
    jobs: jobs.filter((job) => job.category === undefined),
    agents: agents.filter((agent) => agent.category === undefined),
  }
  const left = rest.services.length + rest.stores.length + rest.jobs.length + rest.agents.length
  return left === 0 ? groups : [...groups, rest]
}

const ranks: Readonly<Record<Health, number>> = { critical: 0, attention: 1, unknown: 2, healthy: 2 }

/** Areas with something down first, then degraded, then the rest, each kept in the catalog's order (spec 0068). */
export const needingFirst = (
  groups: ReadonlyArray<Group>,
  healthOf: (name: string) => Health | undefined,
): ReadonlyArray<Group> => {
  const worst = (group: Group) =>
    Math.min(
      2,
      ...[...group.services, ...group.stores, ...group.jobs, ...group.agents].map(
        (entry) => ranks[healthOf(entry.name) ?? "unknown"],
      ),
    )
  return groups
    .map((group, index) => ({ group, index, rank: worst(group) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ group }) => group)
}
