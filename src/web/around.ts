/** What changed near an alert: deploys and builds in the hour before it fired. Pure helpers (no JSX). */
import type { CatalogEvent, DeploysEvent } from "../shared/events"

const hour = 3_600_000

export interface ChangeNear {
  readonly kind: "deploy" | "build"
  readonly service: string
  readonly text: string
  readonly at: string
}

/** Deploys and builds of `service` (and named neighbours) in the hour before `startsAt`. */
export const changesNear = (
  startsAt: string,
  service: string | undefined,
  deploys: DeploysEvent | undefined,
  environment: string | undefined,
  neighbours: ReadonlyArray<string> = [],
): ReadonlyArray<ChangeNear> => {
  if (service === undefined || deploys === undefined) return []
  const fired = Date.parse(startsAt)
  const windowStart = fired - hour
  const names = new Set([service, ...neighbours])
  const found: ChangeNear[] = []
  for (const each of deploys.services) {
    if (!names.has(each.name)) continue
    const env = each.environments.find((row) => row.environment === environment)
    const at = env?.chosen?.at
    if (at !== undefined) {
      const when = Date.parse(at)
      if (when >= windowStart && when <= fired) {
        const version = env?.chosen?.version ?? env?.running ?? "a version"
        found.push({
          kind: "deploy",
          service: each.name,
          text: `${version} deployed`,
          at,
        })
      }
    }
    for (const build of each.builds) {
      const when = Date.parse(build.at)
      if (when >= windowStart && when <= fired) {
        found.push({
          kind: "build",
          service: each.name,
          text: `build ${build.status}: ${build.title}`,
          at: build.at,
        })
      }
    }
  }
  return found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** Services next to this one on the catalog map (depends / callers). */
export const neighboursOf = (catalog: CatalogEvent | undefined, service: string | undefined): ReadonlyArray<string> => {
  if (catalog === undefined || service === undefined) return []
  const node = catalog.map.nodes.find((each) => each.service === service)?.id
  if (node === undefined) return []
  const ids = new Set<string>()
  for (const edge of catalog.map.edges) {
    if (edge.from === node) ids.add(edge.to)
    if (edge.to === node) ids.add(edge.from)
  }
  return catalog.map.nodes
    .filter((each) => ids.has(each.id) && each.service !== undefined && each.service !== service)
    .map((each) => each.service as string)
}
