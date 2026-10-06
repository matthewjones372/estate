/** @jsxImportSource solid-js */
/** Telling the team on Slack, from an alert's card, in happy-dom: run by `tell.test.ts`. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events, operator } from "./fixture"
import { mount } from "./harness"
import { TellTeam } from "./parts/TellTeam"

const alert = events.alerts.alerts[0] as Alert
const slack = { ...operator, slack: true }

describe("telling the team", () => {
  test("is a button where Slack is set up and the team is on it, and says why Slack refused", async () => {
    const page = mount(() => <TellTeam alert={alert} team="Orders" />, { me: slack })
    page.click(page.button("Tell Orders on Slack"))
    await page.settle()
    expect(page.calls).toContainEqual(["tell", "a1"])
    const refused = mount(() => <TellTeam alert={{ ...alert, id: "a9" }} team="Orders" />, { me: slack })
    refused.click(refused.button("Tell Orders on Slack"))
    await refused.settle()
    expect(refused.container.querySelector('[role="alert"]')?.textContent).toBe(
      "Slack refused the message: not_in_channel",
    )
  })

  test("is the thread once told, and nothing without Slack, a team on it, or on a screen", () => {
    const told = mount(() => <TellTeam alert={{ ...alert, thread: { url: "https://slack/thread" } }} team="Orders" />)
    expect(told.container.querySelector("a")?.getAttribute("href")).toBe("https://slack/thread")
    expect(mount(() => <TellTeam alert={alert} team="Orders" />).container.textContent).toBe("")
    expect(mount(() => <TellTeam alert={alert} team={undefined} />, { me: slack }).container.textContent).toBe("")
    expect(
      mount(() => <TellTeam alert={alert} team="Orders" />, { me: { ...slack, kiosk: true } }).container.textContent,
    ).toBe("")
  })
})
