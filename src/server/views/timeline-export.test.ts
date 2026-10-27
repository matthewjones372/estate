import { describe, expect, test } from "bun:test"
import type { Incident } from "../../shared/incidents"
import { estate } from "../fixture"
import { incidentFirings } from "./timeline-export"

const incident = (firings: Incident["firings"]): Incident => ({
  id: "i1",
  title: "Orders late",
  openedBy: "ada",
  openedAt: "2026-10-03T09:00:00Z",
  firings,
})

const swept = {
  environment: "production",
  startsAt: "2026-10-01T09:00:00Z",
  linkedBy: "ada",
  linkedAt: "2026-10-01T09:05:00Z",
}

describe("an incident's firings in its export", () => {
  test("still name one swept since, by the name the incident kept, else its id", () => {
    const firings = incidentFirings(
      estate(),
      incident([
        { ...swept, alert: "Slow-1", name: "OrdersSlow" },
        { ...swept, alert: "Gone-1" },
      ]),
    )
    expect(firings).toEqual([
      {
        environment: "production",
        alert: "Slow-1",
        name: "OrdersSlow",
        startsAt: swept.startsAt,
        firing: false,
        notes: [],
      },
      {
        environment: "production",
        alert: "Gone-1",
        name: "Gone-1",
        startsAt: swept.startsAt,
        firing: false,
        notes: [],
      },
    ])
  })
})
