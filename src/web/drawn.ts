/**
 * What the map draws: the catalog's nodes, or past `collapse` of them, one node a category, its members' count and
 * worst health on it, and the edges between what is drawn, their rates summed. A category opened by the viewer, or
 * holding something that needs someone, is drawn as its own nodes.
 */
import type { CatalogEvent, Health, ServicesEvent } from "../shared/events"

type MapNode = CatalogEvent["map"]["nodes"][number]
type MapEdge = CatalogEvent["map"]["edges"][number]
type Flow = ServicesEvent["edges"][number]

export interface DrawnCategory {
  readonly id: string
  readonly kind: "category"
  readonly title: string
  readonly members: number
  readonly needing: number
  readonly health: Health
}

export type DrawnNode = MapNode | DrawnCategory

export interface DrawnEdge {
  readonly from: string
  readonly to: string
  readonly label?: string
  /** The rate of what it stands for, summed; null when none of them has one. */
  readonly rate: number | null
  readonly alerting: boolean
}

export interface Drawn {
  readonly nodes: ReadonlyArray<DrawnNode>
  readonly edges: ReadonlyArray<DrawnEdge>
  /** The categories drawn as one node, which the viewer can open. */
  readonly closed: ReadonlyArray<string>
  /** The categories opened, which the viewer can close; those that need someone stay open. */
  readonly opened: ReadonlyArray<string>
}

export const categoryId = (category: string) => `category:${category}`

const order: Readonly<Record<Health, number>> = { critical: 0, attention: 1, unknown: 2, healthy: 3 }
const worstOf = (healths: ReadonlyArray<Health>): Health =>
  healths.reduce<Health>((worst, each) => (order[each] < order[worst] ? each : worst), "healthy")

const needs = (health: Health) => health === "attention" || health === "critical"

export const drawnOf = (
  catalog: CatalogEvent,
  services: ServicesEvent | undefined,
  opened: ReadonlySet<string>,
  collapse: number | "never" = 12,
): Drawn => {
  const health = new Map<string, Health>([
    ...(services?.services ?? []).map((each) => [`service:${each.name}`, each.health] as const),
    ...(services?.stores ?? []).map((each) => [`store:${each.name}`, each.health] as const),
  ])
  const category = new Map<string, string>([
    ...catalog.services.flatMap((each) =>
      each.category === undefined ? [] : [[`service:${each.name}`, each.category] as const],
    ),
    ...(catalog.stores ?? []).flatMap((each) =>
      each.category === undefined ? [] : [[`store:${each.name}`, each.category] as const],
    ),
  ])
  const keyOf = (node: MapNode) =>
    node.service !== undefined
      ? `service:${node.service}`
      : node.store !== undefined
        ? `store:${node.store}`
        : undefined
  const nodeHealth = (node: MapNode): Health => {
    const key = keyOf(node)
    return key === undefined ? "healthy" : (health.get(key) ?? "unknown")
  }
  const nodeCategory = (node: MapNode) => {
    const key = keyOf(node)
    return key === undefined ? undefined : category.get(key)
  }
  const flows = new Map((services?.edges ?? []).map((flow) => [`${flow.from}\u0000${flow.to}`, flow] as const))
  const flowOf = (edge: MapEdge): Flow | undefined => flows.get(`${edge.from}\u0000${edge.to}`)
  const { nodes, edges } = catalog.map
  const categories = [...new Set(nodes.flatMap((node) => nodeCategory(node) ?? []))]
  const collapsing = collapse !== "never" && nodes.length > collapse && categories.length > 0
  const urgent = new Set(nodes.filter((node) => needs(nodeHealth(node))).flatMap((node) => nodeCategory(node) ?? []))
  const shut = new Set(collapsing ? categories.filter((each) => !opened.has(each) && !urgent.has(each)) : [])
  const drawnId = (id: string) => {
    const node = nodes.find((each) => each.id === id)
    const within = node === undefined ? undefined : nodeCategory(node)
    return within !== undefined && shut.has(within) ? categoryId(within) : id
  }
  const drawnNodes: DrawnNode[] = []
  for (const node of nodes) {
    const within = nodeCategory(node)
    if (within === undefined || !shut.has(within)) {
      drawnNodes.push(node)
      continue
    }
    if (drawnNodes.some((each) => each.id === categoryId(within))) continue
    const members = nodes.filter((each) => nodeCategory(each) === within)
    const healths = members.map(nodeHealth)
    drawnNodes.push({
      id: categoryId(within),
      kind: "category",
      title: within,
      members: members.length,
      needing: healths.filter(needs).length,
      health: worstOf(healths),
    })
  }
  const merged = new Map<
    string,
    { from: string; to: string; label?: string; rates: number[]; alerting: boolean; count: number }
  >()
  for (const edge of edges) {
    const from = drawnId(edge.from)
    const to = drawnId(edge.to)
    if (from === to) continue
    const key = `${from}\u0000${to}`
    const flow = flowOf(edge)
    const was = merged.get(key) ?? { from, to, rates: [], alerting: false, count: 0 }
    merged.set(key, {
      ...was,
      ...(edge.label === undefined || was.count > 0 ? {} : { label: edge.label }),
      rates: flow?.rate === null || flow?.rate === undefined ? was.rates : [...was.rates, flow.rate],
      alerting: was.alerting || flow?.alerting === true,
      count: was.count + 1,
    })
  }
  return {
    nodes: drawnNodes,
    edges: [...merged.values()].map(({ from, to, label, rates, alerting, count }) => ({
      from,
      to,
      // A label names one edge; an edge standing for several is its rate alone.
      ...(label === undefined || count > 1 ? {} : { label }),
      rate: rates.length === 0 ? null : rates.reduce((total, rate) => total + rate, 0),
      alerting,
    })),
    closed: [...shut],
    opened: collapsing ? categories.filter((each) => opened.has(each) && !urgent.has(each)) : [],
  }
}
