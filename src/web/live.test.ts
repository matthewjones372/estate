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
    for (const path of ["/", "/deploys", "/alerts", "/services/orders%20api", "/stores/orders-db"])
      expect(pathOf(pageOf(path))).toBe(path)
    expect(pageOf("/stores/orders-db")).toEqual({ page: "store", name: "orders-db" })
    expect(pageOf("/services/orders%20api")).toEqual({ page: "service", name: "orders api" })
    expect(pageOf("/nowhere")).toEqual({ page: "missing" })
    expect(pathOf({ page: "missing" })).toBe("/")
  })

  test("the environment is the address's, then the one remembered, then the first", () => {
    expect(chooseEnvironment("prod", "staging", ["staging", "prod"])).toBe("prod")
    expect(chooseEnvironment("qa", "staging", ["staging", "prod"])).toBe("staging")
    expect(chooseEnvironment(null, null, ["staging", "prod"])).toBe("staging")
    expect(chooseEnvironment(null, null, [])).toBeUndefined()
  })
})
