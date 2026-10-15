/** What sits next to a service or store on the catalog's map: one edge either way. */
import type { EstateState } from "../state"

/** The services and stores either side of `subject` on the map, and which side each is on. */
export const neighboursOf = (estate: EstateState, subject: string) => {
  const map = estate.catalog.map
  if (map === undefined) return []
  const named = (id: string) => {
    const node = map.nodes.find((each) => each.id === id)
    return node?.service !== undefined
      ? { name: node.service, kind: "service" as const }
      : node?.store !== undefined
        ? { name: node.store, kind: "store" as const }
        : undefined
  }
  const here = map.nodes.filter((node) => node.service === subject || node.store === subject).map((node) => node.id)
  const found = map.edges.flatMap((edge) => {
    const other = here.includes(edge.from)
      ? { id: edge.to, side: "calls" as const }
      : here.includes(edge.to)
        ? { id: edge.from, side: "called by" as const }
        : undefined
    const node = other === undefined ? undefined : named(other.id)
    return node === undefined || other === undefined || node.name === subject ? [] : [{ ...node, side: other.side }]
  })
  return found.filter((each, index) => found.findIndex((other) => other.name === each.name) === index)
}
