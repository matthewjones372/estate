import { describe, expect, test } from "bun:test"
import type { Incident } from "../../shared/incidents"
import { estate } from "../fixture"
import { incidentFirings } from "./timeline-export"

const incident = (name?: string): Incident => ({
  id: "i1",
  title: "Orders late",
  openedBy: "gil",
  openedAt: "2026-10-03T09:01:00Z",
  firings: [
    {
      environment: "production",
      alert: "a1",
      ...(name === undefined ? {} : { name }),
      startsAt: "2026-10-03T09:00:00Z",
      linkedBy: "gil",
      linkedAt: "2026-10-03T09:01:00Z",
    },
  ],
})

describe("an incident's firings in an export", () => {
  test("a firing swept since is still named, with what the incident kept of it", () => {
    expect(incidentFirings(estate(), incident("KafkaBrokerDown"))).toEqual([
      {
        environment: "production",
        alert: "a1",
        name: "KafkaBrokerDown",
        startsAt: "2026-10-03T09:00:00Z",
        firing: false,
        notes: [],
      },
    ])
  })

  test("a swept firing the incident kept no name for is named by its alert", () => {
    expect(incidentFirings(estate(), incident())[0]?.name).toBe("a1")
  })
})
