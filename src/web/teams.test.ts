import { describe, expect, test } from "bun:test"
import { chatOf, onSlack, teamOf } from "./teams"

const team = (links: Array<{ name: string; url: string }>) => ({ name: "orders", title: "Orders", links })

describe("a team's chat", () => {
  test("is its Slack or Teams channel, and Estate can tell it only on Slack", () => {
    const slack = team([{ name: "slack", url: "https://example.slack.com/archives/C0ORDERS" }])
    const teams = team([{ name: "teams", url: "https://teams.microsoft.com/l/channel/x" }])
    expect(chatOf(slack)).toEqual({ url: "https://example.slack.com/archives/C0ORDERS", text: "Orders on Slack" })
    expect(chatOf(teams)?.text).toBe("Orders on Teams")
    expect([onSlack(slack), onSlack(teams), onSlack(undefined)]).toEqual(["Orders", undefined, undefined])
    expect(chatOf(team([]))).toBeUndefined()
    const catalog = { teams: [slack] } as unknown as Parameters<typeof teamOf>[0]
    expect([teamOf(catalog, "orders")?.title, teamOf(catalog, undefined), teamOf(catalog, "web")]).toEqual([
      "Orders",
      undefined,
      undefined,
    ])
  })
})
