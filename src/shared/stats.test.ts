import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { checkCatalog } from "./check"
import { statsOf } from "./stats"

const service = { name: "ledger", environments: ["home"], kubernetes: { namespace: "money", workloads: [] } }

describe("a service's stats", () => {
  test("a JVM's are heap, GC pauses, threads and CPU, narrowed to it", () => {
    const stats = statsOf({ ...service, stats: { preset: "jvm" } })
    expect(stats.map((stat) => `${stat.title} ${stat.unit ?? ""}`)).toEqual([
      "Heap bytes",
      "GC pause s",
      "Threads ",
      "CPU %",
    ])
    expect(stats[0]?.query).toBe('sum(jvm_memory_used_bytes{area="heap",app="ledger"})')
  })

  test("a process's and a container's, narrowed as the catalog says or by default", () => {
    expect(statsOf({ ...service, stats: { preset: "process", selector: 'job="ledger"' } })[1]?.query).toBe(
      'sum(process_resident_memory_bytes{job="ledger"})',
    )
    expect(statsOf({ ...service, stats: { preset: "container" } })[1]?.query).toBe(
      'sum(container_memory_working_set_bytes{namespace="money",pod=~"ledger-.*",container!=""})',
    )
  })

  test("its own queries come after the preset's, and none means none", () => {
    const extra = { title: "Mailbox depth", query: "max(mailbox_depth)" }
    expect(statsOf({ ...service, stats: { preset: "process", extra: [extra] } }).at(-1)).toEqual(extra)
    expect(statsOf({ ...service, stats: { extra: [extra] } })).toEqual([extra])
    expect(statsOf(service)).toEqual([])
  })

  test("a broken query of its own is a mistake in the catalog", () => {
    const checked = checkCatalog({
      environments: [{ name: "home", sources: "home" }],
      services: [
        { name: "ledger", environments: ["home"], stats: { extra: [{ title: "Depth", query: "max(depth" }] } },
      ],
    })
    expect(Result.isFailure(checked) && checked.failure).toEqual([
      { at: "services[0] (ledger).stats (Depth)", message: "the query is missing a )" },
    ])
  })
})
