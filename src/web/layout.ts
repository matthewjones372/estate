/** Where the map's nodes go: in layers, left to right, each after everything that calls it, spread down the height. */

export interface Placed {
  readonly id: string
  readonly x: number
  readonly y: number
}

export const layout = (
  ids: ReadonlyArray<string>,
  edges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
): ReadonlyMap<string, Placed> => {
  const layer = new Map(ids.map((id) => [id, 0]))
  for (let pass = 0; pass < ids.length; pass++) {
    let moved = false
    for (const edge of edges) {
      const from = layer.get(edge.from)
      const to = layer.get(edge.to)
      if (from !== undefined && to !== undefined && to <= from && edge.from !== edge.to) {
        layer.set(edge.to, from + 1)
        moved = true
      }
    }
    if (!moved) break
  }
  const layers = Math.max(0, ...layer.values()) + 1
  const columns = new Map<number, string[]>()
  for (const id of ids) {
    const column = layer.get(id) ?? 0
    columns.set(column, [...(columns.get(column) ?? []), id])
  }
  const placed = new Map<string, Placed>()
  for (const [column, members] of columns) {
    members.forEach((id, index) => {
      placed.set(id, {
        id,
        x: Number((((column + 0.5) / layers) * 100).toFixed(1)),
        y: Number((((index + 0.5) / members.length) * 100).toFixed(1)),
      })
    })
  }
  return placed
}
