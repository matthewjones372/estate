/**
 * The map as areas (spec 0062): its nodes by the category of what each names, what needs someone first, and, for a
 * part, the busiest edges into and out of it, so a large estate or a phone reads without drawing every line.
 */
import type { CatalogEvent, Health, ServicesEvent } from "../shared/events"
import { amount } from "./format"
import { otherwise } from "./groups"

type MapNode = CatalogEvent["map"]["nodes"][number]
type ServiceState = ServicesEvent["services"][number]
type StoreState = NonNullable<ServicesEvent["stores"]>[number]

export interface Part {
  readonly id: string
  readonly title: string
  readonly health: Health
  /** What the drawing says under its name. */
  readonly sub: string
  /** Its own page, when it has one. */
  readonly to?: string
}

export interface Area {
  /** The category, or none when the catalog names no categories at all. */
  readonly title?: string
  readonly parts: ReadonlyArray<Part>
  readonly needing: number
}

export interface Edge {
  readonly from: string
  readonly to: string
  readonly rate: number | null
}

export interface Next {
  readonly part: Part
  readonly rate: number | null
}

export const needs = (health: Health) => health === "attention" || health === "critical"

/** What a node's box says under its name: a service's requests or version, a store's first reason, or its kind. */
export const subOf = (node: MapNode, service: ServiceState | undefined, store: StoreState | undefined): string => {
  if (node.store !== undefined) return store?.reasons[0] ?? node.kind
  if (node.service === undefined) return node.kind
  const requests = service?.load.requests?.now
  return requests === undefined || requests === null ? (service?.version ?? "") : `${amount(requests)} req/s`
}

export const healthOf = (node: MapNode, service: ServiceState | undefined, store: StoreState | undefined): Health =>
  node.service !== undefined
    ? (service?.health ?? "unknown")
    : node.store !== undefined
      ? (store?.health ?? "unknown")
      : "healthy"

export const pathOf = (node: MapNode): string | undefined =>
  node.service !== undefined
    ? `/services/${encodeURIComponent(node.service)}`
    : node.store === undefined
      ? undefined
      : `/stores/${encodeURIComponent(node.store)}`

const order: Readonly<Record<Health, number>> = { critical: 0, attention: 1, unknown: 2, healthy: 2 }

export const areasOf = (catalog: CatalogEvent, services: ServicesEvent | undefined) => {
  const serviceStates = new Map((services?.services ?? []).map((each) => [each.name, each] as const))
  const storeStates = new Map((services?.stores ?? []).map((each) => [each.name, each] as const))
  const serviceAreas = new Map(catalog.services.map((each) => [each.name, each.category] as const))
  const storeAreas = new Map((catalog.stores ?? []).map((each) => [each.name, each.category] as const))
  const areaOf = (node: MapNode) =>
    node.service !== undefined
      ? serviceAreas.get(node.service)
      : node.store === undefined
        ? undefined
        : storeAreas.get(node.store)
  const parts = new Map<string, Part>()
  const within = new Map<string | undefined, Part[]>()
  const named = catalog.map.nodes.some((node) => areaOf(node) !== undefined)
  for (const node of catalog.map.nodes) {
    const service = node.service === undefined ? undefined : serviceStates.get(node.service)
    const store = node.store === undefined ? undefined : storeStates.get(node.store)
    const to = pathOf(node)
    const part: Part = {
      id: node.id,
      title: node.title,
      health: healthOf(node, service, store),
      sub: subOf(node, service, store),
      ...(to === undefined ? {} : { to }),
    }
    parts.set(node.id, part)
    const title = named ? (areaOf(node) ?? otherwise) : undefined
    within.set(title, [...(within.get(title) ?? []), part])
  }
  // Everything else comes last, whatever order the catalog first names it in.
  const titles = [...within.keys()].sort((a, b) => Number(a === otherwise) - Number(b === otherwise))
  const areas: ReadonlyArray<Area> = titles.map((title) => {
    const each = within.get(title) ?? []
    return {
      ...(title === undefined ? {} : { title }),
      parts: [...each].sort((a, b) => order[a.health] - order[b.health]),
      needing: each.filter((part) => needs(part.health)).length,
    }
  })
  const flows = new Map((services?.edges ?? []).map((flow) => [`${flow.from}\u0000${flow.to}`, flow.rate] as const))
  const edges: ReadonlyArray<Edge> = catalog.map.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    rate: flows.get(`${edge.from}\u0000${edge.to}`) ?? null,
  }))
  return { areas, parts: parts as ReadonlyMap<string, Part>, edges }
}

const busiest = (a: Next, b: Next) => (b.rate ?? -1) - (a.rate ?? -1)

/** What calls a part and what it calls, busiest first. */
export const neighboursOf = (id: string, parts: ReadonlyMap<string, Part>, edges: ReadonlyArray<Edge>) => {
  const next = (end: string | undefined, rate: number | null): ReadonlyArray<Next> => {
    const part = end === undefined ? undefined : parts.get(end)
    return part === undefined ? [] : [{ part, rate }]
  }
  return {
    callers: edges.flatMap((edge) => (edge.to === id ? next(edge.from, edge.rate) : [])).sort(busiest),
    callees: edges.flatMap((edge) => (edge.from === id ? next(edge.to, edge.rate) : [])).sort(busiest),
  }
}

export interface Row {
  readonly before?: Next
  readonly part: Part
  readonly after?: Next
}

/** For each part that needs someone, at most three, the busiest edge into it and out of it; one already shown starts none. */
export const troubleOf = (parts: ReadonlyMap<string, Part>, edges: ReadonlyArray<Edge>): ReadonlyArray<Row> => {
  const rows: Row[] = []
  const shown = new Set<string>()
  for (const part of parts.values()) {
    if (rows.length === 3) break
    if (!needs(part.health) || shown.has(part.id)) continue
    const near = neighboursOf(part.id, parts, edges)
    const before = near.callers[0]
    const after = near.callees[0]
    rows.push({ ...(before === undefined ? {} : { before }), part, ...(after === undefined ? {} : { after }) })
    for (const each of [before?.part, part, after?.part]) if (each !== undefined) shown.add(each.id)
  }
  return rows
}

/** Past `map.areas` services, 12 unless set, the map's *Auto* is areas (spec 0064); `never` keeps it drawn. */
export const manyServices = (catalog: CatalogEvent) => {
  const areas = catalog.map.areas ?? 12
  return areas !== "never" && catalog.services.length > areas
}
