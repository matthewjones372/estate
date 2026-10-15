import { describe, expect, test } from "bun:test"
import { Redacted } from "effect"
import { catalog, settings } from "../fixture"
import { incidentToolOf } from "./incident-tool-of"
import { teamToolsOf } from "./incident-tools"

describe("the incident tool", () => {
  test("is the kind the settings name, and none where they name none", () => {
    const pagerduty = { token: Redacted.make("pd"), from: "estate@example.com", service: "PABC123" }
    expect(incidentToolOf({ ...settings(), incidentTool: { pagerduty } })?.name).toBe("PagerDuty")
    const incidentio = { token: Redacted.make("io"), severity: "Minor" }
    expect(incidentToolOf({ ...settings(), incidentTool: { incidentio } })?.name).toBe("incident.io")
    expect(incidentToolOf(settings())).toBeUndefined()
  })

  test("sends an incident where the team owning its service says, and nowhere of its own otherwise", () => {
    const owned = {
      ...catalog,
      services: catalog.services.map((each, index) => (index === 0 ? { ...each, owner: "payments" } : each)),
      teams: [{ name: "payments", incidentTool: { pagerduty: "PDEF456" } }],
    }
    expect(teamToolsOf(owned, owned.services[0]?.name)).toEqual({ pagerduty: "PDEF456" })
    expect(teamToolsOf(owned, owned.services[1]?.name)).toBeUndefined()
    expect(teamToolsOf(owned, undefined)).toBeUndefined()
  })
})
