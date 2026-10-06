/**
 * The catalog shown: the written one, with what discovery found after it. A found entry is checked as a written one
 * is and left out with its mistakes when it fails; a written entry of the same name wins whole.
 */
import { Result } from "effect"
import type { Catalog, Service } from "../../shared/catalog"
import { checkCatalog } from "../../shared/check"
import type { Mistake } from "../../shared/shape"

export interface Checked {
  readonly kept: ReadonlyArray<Service>
  readonly leftOut: ReadonlyArray<{ readonly name: string; readonly mistakes: ReadonlyArray<Mistake> }>
}

const nameOf = (entry: unknown) =>
  typeof entry === "object" && entry !== null && "name" in entry ? String(entry.name) : "?"

/** Each found entry checked against the written catalog's environments and teams, as if it were written there. */
export const checked = (written: Catalog, entries: ReadonlyArray<unknown>): Checked => {
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
    else for (const service of result.success.services) kept.push({ ...service, discovered: { from: "kubernetes" } })
  }
  return { kept, leftOut }
}

/** The written catalog with the found services after it, and the names a written entry took over. */
export const shown = (written: Catalog, found: ReadonlyArray<Service>) => {
  const names = new Set(written.services.map((service) => service.name))
  return {
    catalog: { ...written, services: [...written.services, ...found.filter((service) => !names.has(service.name))] },
    writtenOver: found.filter((service) => names.has(service.name)).map((service) => service.name),
  }
}
