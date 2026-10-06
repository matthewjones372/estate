import { describe, expect, test } from "bun:test"
import { alertsSaid, codeLine, needsLook } from "./code"

const severities = (critical: number, high: number, medium = 0, low = 0) => ({ critical, high, medium, low })

describe("a service's code health, said", () => {
  test("is its gate, its coverage and its open alerts, worst first", () => {
    expect(
      codeLine({
        sonarqube: { gate: "passed", coverage: 82.4, href: "s" },
        dependabot: { alerts: severities(0, 1, 2), href: "d" },
        scanning: { alerts: severities(0, 0, 0, 1), href: "c" },
      }),
    ).toBe("gate passed · 82% covered · 1 high, 2 medium, 1 low alerts")
    expect(codeLine({ dependabot: { alerts: severities(0, 0), href: "d" } })).toBe("no open alerts")
    expect(codeLine({ sonarqube: { gate: "none", href: "s" } })).toBe("")
    expect(codeLine(undefined)).toBe("")
    expect(alertsSaid(severities(1, 0))).toBe("1 critical alert")
  })

  test("needs a look when its gate failed or a critical or high alert is open", () => {
    expect(needsLook({ sonarqube: { gate: "failed", href: "s" } })).toBe(true)
    expect(needsLook({ scanning: { alerts: severities(0, 1), href: "c" } })).toBe(true)
    expect(needsLook({ dependabot: { alerts: severities(0, 0, 5), href: "d" } })).toBe(false)
    expect(needsLook(undefined)).toBe(false)
  })
})
