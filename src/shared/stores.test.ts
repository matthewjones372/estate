import { describe, expect, test } from "bun:test"
import type { Store } from "./catalog"
import { engines, reasonsOf, storeStatsOf } from "./stores"

const store = (engine: Store["engine"], attention?: Record<string, number>): Store => ({
  name: "db",
  environments: ["staging"],
  engine,
  selector: 'database="db"',
  ...(attention === undefined ? {} : { attention }),
})

describe("a store's preset", () => {
  test("gives every engine's stats, narrowed by the store's selector, then the store's own", () => {
    for (const engine of engines) {
      const stats = storeStatsOf(store(engine))
      expect(stats.length).toBeGreaterThanOrEqual(4)
      for (const stat of stats) expect(stat.query).toContain('database="db"')
    }
    const own = storeStatsOf({ ...store("postgres"), extra: [{ title: "Outbox lag", query: "max(outbox_lag)" }] })
    expect(own.at(-1)).toEqual({ key: "extra0", title: "Outbox lag", query: "max(outbox_lag)" })
  })

  test("says why a store needs someone, past its thresholds or the catalog's", () => {
    expect(reasonsOf(store("postgres"), { connections: 85, lag: 2 })).toEqual(["85% of its connections are in use"])
    expect(reasonsOf(store("postgres", { connections: 90 }), { connections: 85, lag: 45 })).toEqual([
      "a replica is 45 s behind",
    ])
    expect(reasonsOf(store("cnpg"), { connections: 10, lag: 0, down: 1, backup: 2 * 86_400 })).toEqual([
      "1 instance is not ready",
      "no backup for 48 h",
    ])
    expect(reasonsOf(store("cnpg"), { down: 2 })).toEqual(["2 instances are not ready"])
    expect(reasonsOf(store("redis"), { memory: 95.5, evictions: 3.25 })).toEqual([
      "96% of its memory is used",
      "evicting 3.3 keys a second",
    ])
    expect(reasonsOf(store("kafka"), { growing: 0.4, underReplicated: 1 })).toEqual([
      "consumer lag has grown for ten minutes",
      "1 partition is under-replicated",
    ])
    expect(reasonsOf(store("kafka"), { underReplicated: 3 })).toEqual(["3 partitions are under-replicated"])
    expect(reasonsOf(store("mysql"), { connections: null, lag: 31 })).toEqual(["a replica is 31 s behind"])
    expect(reasonsOf(store("redis"), {})).toEqual([])
  })
})
