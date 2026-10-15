import { describe, expect, test } from "bun:test"
import type { EvidenceSet } from "../shared/evidence"
import { sizeOf, withinLimit } from "./evidence-limit"

const line = (minute: number) => ({ at: `2026-10-12T14:${String(minute).padStart(2, "0")}:00Z`, text: "x".repeat(200) })
const trace = (id: string) => ({
  id,
  environment: "staging",
  why: "slowest" as const,
  spans: [
    { id: "a", service: "orders", name: "y".repeat(200), kind: "server" as const, start: 0, end: 1, failed: false },
  ],
})
const set: EvidenceSet = {
  id: "s",
  keptAt: "2026-10-12T15:00:00Z",
  keptBy: "Estate",
  window: { start: 0, end: 3600, step: 60 },
  charts: [
    { service: "orders", environment: "staging", panel: "requests", query: "q", points: Array(60).fill(1) },
    { service: "orders", environment: "staging", panel: "errors", query: "q", points: Array(60).fill(0) },
  ],
  logs: [
    {
      service: "orders",
      environment: "staging",
      from: "Loki",
      errors: [{ shape: "ERROR z", count: 2, firstSeen: "a", lastSeen: "b", pods: [], examples: [line(1)] }],
      lines: [line(1), line(2), line(3)],
      leftOut: 0,
    },
  ],
  traces: [trace("t1"), trace("t2")],
}

describe("an incident's evidence past its limit", () => {
  test("keeps its charts first, then errors, then traces, then lines, and names what was left out", () => {
    const { charts, logs, traces } = set
    const bare = { ...set, charts: [], logs: logs?.map((each) => ({ ...each, errors: [], lines: [] })), traces: [] }
    // Room for the charts, the errors and one trace, and not a line more.
    const room =
      sizeOf(bare) +
      [...charts, ...(logs?.[0]?.errors ?? []), traces?.[0]].reduce((total, each) => total + sizeOf(each) + 1, 0)
    const kept = withinLimit(set, room + 200)
    expect(kept.charts).toHaveLength(2)
    expect(kept.logs?.[0]?.errors).toHaveLength(1)
    expect(kept.traces?.map((each) => each.id)).toEqual(["t1"])
    expect(kept.logs?.[0]?.lines).toEqual([])
    expect(kept.leftOut).toEqual(["1 trace and 3 lines past incidents.evidence.maxMegabytes"])
    expect(withinLimit(set, sizeOf(set) * 2)).toEqual(set)
  })

  test("keeps the newest lines when only some fit", () => {
    const { logs } = set
    const bare = { ...set, logs: logs?.map((each) => ({ ...each, lines: [] })) }
    const kept = withinLimit(set, sizeOf(bare) + 2 * (sizeOf(line(3)) + 1) + 200)
    expect(kept.logs?.[0]?.lines.map((each) => each.at)).toEqual([line(2).at, line(3).at])
    expect(kept.leftOut).toEqual(["1 line past incidents.evidence.maxMegabytes"])
  })
})
