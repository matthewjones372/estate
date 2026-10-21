/**
 * The catalog shown: the written one, with what discovery found after it. A found entry is checked as a written one
 * is and left out with its mistakes when it fails; a written entry of the same name wins whole.
 */
import { Result } from "effect"
import type { Catalog, Service, Store } from "../../shared/catalog"
import { checkCatalog } from "../../shared/check"
import type { Mistake } from "../../shared/shape"

export interface Checked {
  readonly kept: ReadonlyArray<Service>
  readonly leftOut: ReadonlyArray<{ readonly name: string; readonly mistakes: ReadonlyArray<Mistake> }>
}

const nameOf = (entry: unknown) =>
  typeof entry === "object" && entry !== null && "name" in entry ? String(entry.name) : "?"

/** Each found entry checked against the written catalog's environments and teams, as if it were written there. */
export const checked = (
  written: Catalog,
  entries: ReadonlyArray<unknown>,
  from: "kubernetes" | "backstage" = "kubernetes",
): Checked => {
  const kept: Array<Service> = []
  const leftOut: Array<Checked["leftOut"][number]> = []
  for (const entry of entries) {
    // Checked unmarked, since a written entry may not carry the mark, and marked again once it passes.
    const { discovered, ...unmarked } = entry as Record<string, unknown>
    const result = checkCatalog({
      environments: written.environments,
      ...(written.teams === undefined ? {} : { teams: written.teams }),
      services: [unmarked],
    })
    if (Result.isFailure(result)) leftOut.push({ name: nameOf(entry), mistakes: result.failure })
    else for (const service of result.success.services) kept.push({ ...service, discovered: { from } })
  }
  return { kept, leftOut }
}

/**
 * The written catalog with the found services and stores after it, the names a written entry took over, and the
 * found entries left out because an entry of another kind has their name: the written one wins, then a service.
 */
export const shown = (written: Catalog, found: ReadonlyArray<Service>, stores: ReadonlyArray<Store> = []) => {
  const names = new Set(written.services.map((service) => service.name))
  const storeNames = new Set((written.stores ?? []).map((store) => store.name))
  const foundServices = found.filter((service) => !names.has(service.name) && !storeNames.has(service.name))
  const serviceNames = new Set([...names, ...foundServices.map((service) => service.name)])
  const foundStores = stores.filter((store) => !storeNames.has(store.name) && !serviceNames.has(store.name))
  const clashes = [
    ...found
      .filter((service) => !names.has(service.name) && storeNames.has(service.name))
      .map((service) => `${service.name}: a written store has this name`),
    ...stores
      .filter((store) => !storeNames.has(store.name) && serviceNames.has(store.name))
      .map((store) => `${store.name}: a ${names.has(store.name) ? "written" : "found"} service has this name`),
  ]
  return {
    clashes,
    catalog: {
      ...written,
      services: [...written.services, ...foundServices],
      ...(written.stores === undefined && foundStores.length === 0
        ? {}
        : { stores: [...(written.stores ?? []), ...foundStores] }),
    },
    writtenOver: [
      ...found.filter((service) => names.has(service.name)).map((service) => service.name),
      ...stores.filter((store) => storeNames.has(store.name)).map((store) => store.name),
    ],
  }
}
