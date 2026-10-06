import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { createLive, type Handlers } from "./live"
import { chooseEnvironment, pageOf, pathOf } from "./route"

const opened = () => {
  const streams: Array<{ environment: string; handlers: Handlers; closed: boolean }> = []
  const live = createLive(
    (environment, handlers) => {
      const stream = { environment, handlers, closed: false }
      streams.push(stream)
      return () => {
        stream.closed = true
      }
    },
    "staging",
    () => 42,
  )
  return { live, streams }
}

describe("the page's store", () => {
  test("holds each event as it arrives, decoded, and tells who listens", () => {
    const { live, streams } = opened()
    let told = 0
    live.subscribe(() => {
      told += 1
    })
    streams[0]?.handlers.onOpen()
    streams[0]?.handlers.onEvent("feed", JSON.stringify(events.feed))
    expect(live.snapshot()).toMatchObject({
      environment: "staging",
      connection: "open",
      heardAt: 42,
      events: { feed: events.feed },
    })
    expect(told).toBe(2)
  })

  test("hears the server's beat as being told, though nothing changed", () => {
    const { live, streams } = opened()
    streams[0]?.handlers.onBeat()
    expect(live.snapshot()).toMatchObject({ connection: "open", heardAt: 42, events: {} })
  })

  test("merges a partial services event into the services it has, by name", () => {
    const { live, streams } = opened()
    streams[0]?.handlers.onEvent("services", JSON.stringify(events.services))
    const expected = events.services.services.map((each, index) =>
      index === 1 ? { ...each, reasons: ["changed"] } : each,
    )
    streams[0]?.handlers.onEvent(
      "services",
      JSON.stringify({ ...events.services, partial: true, services: expected.slice(1, 2) }),
    )
    expect(live.snapshot().events.services?.services).toEqual(expected)
    expect(live.snapshot().events.services?.partial).toBeUndefined()
  })

  test("takes a partial event's other parts over those it has, and keeps the ones it leaves out", () => {
    const { live, streams } = opened()
    streams[0]?.handlers.onEvent("services", JSON.stringify(events.services))
    const vitals = [{ title: "Orders", series: { now: 7, points: [7] } }]
    streams[0]?.handlers.onEvent("services", JSON.stringify({ partial: true, services: [], vitals }))
    expect(live.snapshot().events.services?.vitals).toEqual(vitals)
    expect(live.snapshot().events.services?.sources).toEqual(events.services.sources)
    expect(live.snapshot().events.services?.services).toEqual(events.services.services)
  })

  test("leaves what it has when a whole services event lacks a part", () => {
    const { live, streams } = opened()
    const { sources: _, ...lacking } = events.services
    streams[0]?.handlers.onEvent("services", JSON.stringify(lacking))
    expect(live.snapshot().events.services).toBeUndefined()
  })

  test("takes a partial services event whole when it has none yet", () => {
    const { live, streams } = opened()
    streams[0]?.handlers.onEvent("services", JSON.stringify({ ...events.services, partial: true }))
    expect(live.snapshot().events.services?.services).toHaveLength(events.services.services.length)
  })

  test("ignores what does not decode", () => {
    const { live, streams } = opened()
    streams[0]?.handlers.onEvent("feed", "{not json")
    streams[0]?.handlers.onEvent("feed", JSON.stringify({ items: "no" }))
    expect(live.snapshot().events).toEqual({})
  })

  test("says when the stream is lost", () => {
    const { live, streams } = opened()
    streams[0]?.handlers.onLost()
    expect(live.snapshot().connection).toBe("lost")
  })

  test("choosing another environment closes one stream, opens the next and forgets what it heard", () => {
    const { live, streams } = opened()
    streams[0]?.handlers.onEvent("feed", JSON.stringify(events.feed))
    live.choose("staging")
    expect(streams).toHaveLength(1)
    live.choose("production")
    expect(streams.map((stream) => [stream.environment, stream.closed])).toEqual([
      ["staging", true],
      ["production", false],
    ])
    expect(live.snapshot()).toMatchObject({ environment: "production", connection: "connecting", events: {} })
  })
})

describe("where the page is", () => {
  test("the path names the page, and back again", () => {
    for (const path of [
      "/",
      "/deploys",
      "/alerts",
      "/alerts/a1",
      "/services/orders%20api",
      "/stores/orders-db",
      "/jobs/nightly-settlement",
      "/agents/support-triage",
    ])
      expect(pathOf(pageOf(path))).toBe(path)
    expect(pageOf("/stores/orders-db")).toEqual({ page: "store", name: "orders-db" })
    expect(pageOf("/jobs/nightly-settlement")).toEqual({ page: "job", name: "nightly-settlement" })
    expect(pageOf("/agents/support-triage")).toEqual({ page: "agent", name: "support-triage" })
    expect(pageOf("/alerts/a1")).toEqual({ page: "alert", id: "a1" })
    expect(pageOf("/services/orders%20api")).toEqual({ page: "service", name: "orders api" })
    expect(pageOf("/nowhere")).toEqual({ page: "missing" })
    // A path that was never validly escaped, or names no kind of page, is missing, not an error.
    expect(pageOf("/alerts/%E0")).toEqual({ page: "missing" })
    expect(pageOf("/constructor/x")).toEqual({ page: "missing" })
    expect(pathOf({ page: "missing" })).toBe("/")
    expect(pageOf("/kiosk", "?team=payments&env=production")).toEqual({ page: "kiosk", team: "payments" })
    expect(pageOf("/kiosk", "?category=Data")).toEqual({ page: "kiosk", category: "Data" })
    expect(pathOf(pageOf("/kiosk"))).toBe("/kiosk")
  })

  test("the environment is the address's, then the one remembered, then the first", () => {
    expect(chooseEnvironment("prod", "staging", ["staging", "prod"])).toBe("prod")
    expect(chooseEnvironment("qa", "staging", ["staging", "prod"])).toBe("staging")
    expect(chooseEnvironment(null, null, ["staging", "prod"])).toBe("staging")
    expect(chooseEnvironment(null, null, [])).toBeUndefined()
  })
})
