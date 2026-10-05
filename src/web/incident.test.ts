import { describe, expect, test } from "bun:test"
import { fillIncident, incidentOf } from "./incident"

describe("an incident link", () => {
  test("is found as incident or raise-incident, and missing otherwise", () => {
    expect(incidentOf([{ name: "logs", url: "https://logs" }])).toBeUndefined()
    expect(incidentOf(undefined)).toBeUndefined()
    expect(incidentOf([{ name: "incident", url: "https://pd/{alert}" }])).toEqual({
      name: "incident",
      url: "https://pd/{alert}",
    })
    expect(incidentOf([{ name: "raise-incident", url: "https://og/{summary}" }])?.name).toBe("raise-incident")
  })

  test("fills {alert} and {summary}, encoded, and empties them when unset", () => {
    const template = "https://pd.example/create?title={alert}&body={summary}&x={alert}"
    expect(fillIncident(template, { alert: "OrdersSlow", summary: "Orders are slow" })).toBe(
      "https://pd.example/create?title=OrdersSlow&body=Orders%20are%20slow&x=OrdersSlow",
    )
    expect(fillIncident(template)).toBe("https://pd.example/create?title=&body=&x=")
    expect(fillIncident("https://pd.example/create?service=storefront")).toBe(
      "https://pd.example/create?service=storefront",
    )
  })
})
