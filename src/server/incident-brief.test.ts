import { describe, expect, test } from "bun:test"
import type { IncidentRecord } from "../shared/incidents"
import { allSeenLive } from "../shared/timeline"
import { briefReadsLogs, incidentBrief } from "./incident-brief"

const window = { start: 1_760_288_000, end: 1_760_288_240, step: 60 }
const span = (id: string, name: string, start: number, end: number, failed = false) => ({
  id,
  service: "registry",
  name,
  kind: "server" as const,
  start,
  end,
  failed,
})
const record: IncidentRecord = {
  incident: {
    id: "i1",
    title: "Chip registry slow",
    openedBy: "gil",
    openedAt: "2026-10-12T16:50:00Z",
    closedBy: "ada",
    closedAt: "2026-10-12T17:10:00Z",
    ended: "restarted the registry",
    firings: [
      {
        environment: "staging",
        alert: "a1",
        name: "ChipRegistryUnreachable",
        startsAt: "2026-10-12T16:47:58Z",
        linkedBy: "gil",
        linkedAt: "2026-10-12T16:50:00Z",
      },
    ],
  },
  events: allSeenLive([
    { id: "e1", at: "2026-10-12T16:52:00Z", by: "gil", kind: "happened", text: "rolled the registry back" },
  ]).map((event) => ({ ...event, environment: "", alert: "" })),
  services: ["registry"],
  versions: [{ service: "registry", environment: "staging", start: "1.8.0", changes: [], close: "1.7.3" }],
  window: { from: "2026-10-12T16:17:58Z", to: "2026-10-12T17:10:00Z" },
  evidence: [
    {
      id: "e1",
      keptAt: "2026-10-12T17:10:00Z",
      keptBy: "Estate",
      window,
      charts: [
        { service: "registry", environment: "staging", panel: "p99", unit: "s", query: "q", points: [null, 2, 9, 1] },
        { service: "registry", environment: "staging", panel: "requests", query: "q", points: [null, null] },
      ],
      traces: [
        {
          id: "t1",
          environment: "staging",
          why: "slowest",
          spans: [span("a", "GET /chips", 0, 9100, true), span("b", "SELECT", 100, 300)],
        },
      ],
    },
  ],
}

describe("an incident's brief", () => {
  test("says its record, a chart as its first, last, lowest and highest, and a trace as its longest steps", () => {
    const brief = incidentBrief(record)
    expect(brief).toContain("Closed by ada at 2026-10-12T17:10:00Z: restarted the registry")
    expect(brief).toContain("- ChipRegistryUnreachable in staging, from 2026-10-12T16:47:58Z")
    expect(brief).toContain("- registry: 1.8.0 at start, no change, 1.7.3 at close")
    expect(brief).toContain("rolled the registry back")
    expect(brief).toContain(
      "registry p99 in staging: first 2s at 2025-10-12T16:54, last 1s at 2025-10-12T16:56, lowest 1s at 2025-10-12T16:56, highest 9s at 2025-10-12T16:55",
    )
    expect(brief).toContain("registry requests: no points")
    expect(brief).toContain("- trace t1, 9100 ms: registry GET /chips 9100 ms failed; registry SELECT 200 ms")
    expect(briefReadsLogs(record)).toBe(true)
    expect(briefReadsLogs({ ...record, evidence: [] })).toBe(false)
  })
})
