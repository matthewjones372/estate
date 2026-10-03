import { describe, expect, test } from "bun:test"
import { layout } from "./layout"

/** The map's sizes, as Map.tsx makes them: a node's box, and a row's and a column's room. */
const node = { width: 112, height: 44 }
const sizeOf = (rows: number, columns: number) => ({
  height: Math.max(380, rows * 60 + 20),
  width: Math.max(720, columns * 170),
})

const overlapping = (ids: ReadonlyArray<string>, edges: ReadonlyArray<{ from: string; to: string }>) => {
  const { at, rows, columns } = layout(ids, edges)
  const size = sizeOf(rows, columns)
  const boxes = [...at.values()].map((each) => ({
    id: each.id,
    x: (each.x / 100) * size.width,
    y: (each.y / 100) * size.height,
  }))
  return boxes.flatMap((a, index) =>
    boxes
      .slice(index + 1)
      .filter((b) => Math.abs(a.x - b.x) < node.width && Math.abs(a.y - b.y) < node.height)
      .map((b) => `${a.id}/${b.id}`),
  )
}

describe("the map's layout", () => {
  test("puts each node after everything that calls it, and says how many rows and columns it used", () => {
    const { at, rows, columns } = layout(
      ["web", "orders", "db", "cache"],
      [
        { from: "web", to: "orders" },
        { from: "orders", to: "db" },
        { from: "web", to: "cache" },
      ],
    )
    expect([at.get("web")?.x, at.get("orders")?.x, at.get("db")?.x]).toEqual([16.7, 50, 83.3])
    expect([rows, columns]).toEqual([2, 3])
  })

  test("never overlaps two nodes, with forty in one column or eight columns deep", () => {
    const forty = Array.from({ length: 40 }, (_, index) => `s${index}`)
    expect(
      overlapping(
        ["gateway", ...forty],
        forty.map((id) => ({ from: "gateway", to: id })),
      ),
    ).toEqual([])
    const chain = Array.from({ length: 8 }, (_, index) => `c${index}`)
    expect(
      overlapping(
        chain,
        chain.slice(1).map((id, index) => ({ from: `c${index}`, to: id })),
      ),
    ).toEqual([])
  })

  test("draws each node level with what calls it", () => {
    const { at } = layout(
      ["gateway", "a", "b", "b1", "b2", "a1"],
      [
        { from: "gateway", to: "a" },
        { from: "gateway", to: "b" },
        { from: "b", to: "b1" },
        { from: "b", to: "b2" },
        { from: "a", to: "a1" },
      ],
    )
    const order = ["a1", "b1", "b2"].toSorted((x, y) => (at.get(x)?.y ?? 0) - (at.get(y)?.y ?? 0))
    expect(order).toEqual(["a1", "b1", "b2"])
  })

  test("is empty for no nodes, and survives a cycle", () => {
    expect(layout([], [])).toEqual({ at: new Map(), rows: 0, columns: 1 })
    expect(
      layout(
        ["a", "b"],
        [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      ).at.size,
    ).toBe(2)
  })
})
