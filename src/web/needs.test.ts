import { describe, expect, test } from "bun:test"
import type { Alert, Events } from "../shared/events"
import { events } from "./fixture"
import { headlineOf, openedOf } from "./hero"
import { thingsOf } from "./needs"

const incident = { id: "i1", title: "Orders reach the warehouse late", closed: false, openedAt: "2026-10-03T11:55:00Z" }

const firing = (name: string, over: Partial<Alert>): Alert => ({
  id: name,
  name,
  state: "firing",
  severity: "critical",
  startsAt: "2026-10-03T11:50:00Z",
  labels: {},
  notes: [],
  ...over,
})

const lagging = firing("ConsumerLagGrowing", {
  service: "orders",
  startsAt: "2026-10-03T11:52:00Z",
  incident,
  impact: { text: "Orders reach the warehouse late; slots may be missed.", from: "catalog" },
  notes: [
    { id: "n2", at: "2026-10-03T11:58:00Z", by: "ada", text: "Told the warehouse.\nMore later.", incident },
    { id: "n1", at: "2026-10-03T11:56:00Z", by: "gil", text: "Looking at the cluster.", incident },
  ],
})
const brokerDown = firing("KafkaBrokerDown", { store: "bus", summary: "Broker 4 of bus is not reporting", incident })

const withIncident: Events = {
  ...events,
  catalog: { ...events.catalog, stores: [{ name: "bus", engine: "kafka", links: [] }] },
  alerts: { ...events.alerts, alerts: [...events.alerts.alerts, lagging, brokerDown] },
}

describe("the things that need someone", () => {
  test("are an incident with its alerts, an alert in none and a stuck deploy, counted once", () => {
    expect(thingsOf(withIncident).map((thing) => [thing.kind, thing.title])).toEqual([
      ["incident", "Orders reach the warehouse late"],
      ["alert", "Orders are slow"],
      ["deploy", "orders cannot roll out its new version"],
    ])
    expect(headlineOf(withIncident).top).toBe("Three things")
  })

  test("say a stuck deploy in Estate's words, the tool's message left to its page", () => {
    const stuck = thingsOf(events).find((thing) => thing.kind === "deploy")
    expect(stuck?.to).toBe("/services/orders")
    expect(stuck?.what).toBe("v7 still serves; its page says what the deploy tool said.")
    expect(JSON.stringify(thingsOf(events))).not.toContain("cannot scan the registry")
  })

  test("count a degraded entry only when nothing else is about it", () => {
    const degraded = {
      ...events,
      alerts: { ...events.alerts, alerts: [] },
      deploys: { ...events.deploys, services: [] },
    }
    expect(thingsOf(degraded)).toMatchObject([
      { kind: "degraded", title: "storefront is degraded", what: "OrdersSlow is firing.", to: "/services/storefront" },
    ])
    expect(thingsOf(events).filter((thing) => thing.about.includes("storefront"))).toHaveLength(1)
  })

  test("name an alert's store by the catalog, with its kind beside it", () => {
    const { incident: _, ...unlinked } = brokerDown
    const thing = thingsOf({ ...withIncident, alerts: { ...events.alerts, alerts: [unlinked] } })[0]
    expect(thing?.what).toBe("KafkaBrokerDown on bus (Kafka).")
  })
})

describe("an open incident at the top", () => {
  test("is said as its impact, the store alert as its likely cause, and its latest note", () => {
    const opened = openedOf(withIncident)
    expect(opened?.impact).toBe("Orders reach the warehouse late; slots may be missed.")
    expect(opened?.cause).toEqual({ where: "bus (Kafka)", text: "Broker 4 of bus is not reporting" })
    expect(opened?.latest).toMatchObject({ by: "ada", text: "Told the warehouse.\nMore later." })
  })

  test("names no cause when it holds one alert, and is its title without an impact", () => {
    const { impact: _, ...plain } = lagging
    const one = { ...events, alerts: { ...events.alerts, alerts: [plain] } }
    expect(openedOf(one)).toMatchObject({ impact: "Orders reach the warehouse late" })
    expect(openedOf(one)?.cause).toBeUndefined()
    expect(openedOf(events)).toBeUndefined()
  })
})
