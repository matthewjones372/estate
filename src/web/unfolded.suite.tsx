/** @jsxImportSource solid-js */
/** How an open incident unfolded, on the overview (spec 0068): run by `unfolded.test.ts`. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events } from "./fixture"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"
import { unfoldedOf } from "./unfolded"

const incident = { id: "i1", title: "Orders reach the warehouse late", closed: false, openedAt: "2026-10-03T11:55:00Z" }
const looking = { id: "n1", at: "2026-10-03T11:56:00Z", by: "gil", text: "Looking at the cluster.", incident }
const told = { id: "n2", at: "2026-10-03T11:58:00Z", by: "ada", text: "Told the warehouse.", incident }
const own = { id: "n3", at: "2026-10-03T11:57:00Z", by: "bo", text: "Only on this alert." }

const fired = (name: string, startsAt: string, notes: Alert["notes"]): Alert => ({
  id: name,
  name,
  state: "firing",
  severity: "critical",
  service: "orders",
  summary: `${name} summary`,
  startsAt,
  labels: {},
  notes,
  incident,
})

const alerts = [
  fired("ConsumerLagGrowing", "2026-10-03T11:52:00Z", [told, looking]),
  fired("KafkaBrokerDown", "2026-10-03T11:50:00Z", [told, own, looking]),
]

describe("how an incident unfolded", () => {
  test("is its alerts as they fired and its notes, oldest first, each note once", () => {
    expect(unfoldedOf("i1", alerts).map((each) => (each.kind === "fired" ? each.alert.name : each.text))).toEqual([
      "KafkaBrokerDown",
      "ConsumerLagGrowing",
      "Looking at the cluster.",
      "Told the warehouse.",
    ])
  })

  test("is on the overview while it is open, and a note added there is the incident's", async () => {
    const page = mount(() => <Overview />, { sent: { ...events, alerts: { ...events.alerts, alerts } } })
    const section = page.container.querySelector("#unfolded")?.closest("section")
    const lines = [...(section?.querySelectorAll(".unfolded-list > li") ?? [])].map((line) => line.textContent)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain("Alert firedKafkaBrokerDown: KafkaBrokerDown summary")
    expect(lines[3]).toContain("adaTold the warehouse.")
    const input = section?.querySelector<HTMLInputElement>(".note-form input")
    if (input === null || input === undefined) throw new Error("no note box")
    page.type(input, "Scaling picking to 6")
    await page.settle()
    page.click(page.button("Add note"))
    await page.settle()
    expect(page.calls).toContainEqual(["addIncidentNote", "i1", "Scaling picking to 6"])
    expect(mount(() => <Overview />).container.querySelector("#unfolded")).toBeNull()
  })
})
