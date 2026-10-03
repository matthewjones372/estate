/** The overview's lanes in groups: one a category, in the order the catalog first names each, the rest last. */
import type { CatalogEvent } from "../shared/events"

type Services = CatalogEvent["services"]
type Stores = NonNullable<CatalogEvent["stores"]>
type Jobs = NonNullable<CatalogEvent["jobs"]>

export interface Group {
  /** The category, or none when the catalog names no categories at all. */
  readonly title?: string
  readonly services: Services
  readonly stores: Stores
  readonly jobs: Jobs
}

export const otherwise = "Everything else"

export const groupsOf = (catalog: CatalogEvent | undefined): ReadonlyArray<Group> => {
  const services = catalog?.services ?? []
  const stores = catalog?.stores ?? []
  const jobs = catalog?.jobs ?? []
  const named = [...services, ...stores, ...jobs].flatMap((each) =>
    each.category === undefined ? [] : [each.category],
  )
  if (named.length === 0) return [{ services, stores, jobs }]
  const titles = [...new Set(named)]
  const groups = titles.map((title) => ({
    title,
    services: services.filter((service) => service.category === title),
    stores: stores.filter((store) => store.category === title),
    jobs: jobs.filter((job) => job.category === title),
  }))
  const rest = {
    title: otherwise,
    services: services.filter((service) => service.category === undefined),
    stores: stores.filter((store) => store.category === undefined),
    jobs: jobs.filter((job) => job.category === undefined),
  }
  return rest.services.length + rest.stores.length + rest.jobs.length === 0 ? groups : [...groups, rest]
}
