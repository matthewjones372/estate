/** The overview's lanes in groups: one a category, in the order the catalog first names each, the rest last. */
import type { CatalogEvent } from "../shared/events"

type Services = CatalogEvent["services"]
type Stores = NonNullable<CatalogEvent["stores"]>

export interface Group {
  /** The category, or none when the catalog names no categories at all. */
  readonly title?: string
  readonly services: Services
  readonly stores: Stores
}

export const otherwise = "Everything else"

export const groupsOf = (catalog: CatalogEvent | undefined): ReadonlyArray<Group> => {
  const services = catalog?.services ?? []
  const stores = catalog?.stores ?? []
  const named = [...services, ...stores].flatMap((each) => (each.category === undefined ? [] : [each.category]))
  if (named.length === 0) return [{ services, stores }]
  const titles = [...new Set(named)]
  const groups = titles.map((title) => ({
    title,
    services: services.filter((service) => service.category === title),
    stores: stores.filter((store) => store.category === title),
  }))
  const rest = {
    title: otherwise,
    services: services.filter((service) => service.category === undefined),
    stores: stores.filter((store) => store.category === undefined),
  }
  return rest.services.length + rest.stores.length === 0 ? groups : [...groups, rest]
}
