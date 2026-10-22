import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import type { FeedItem } from "../shared/feed"
import { marksOf } from "./chart-marks"

const end = Date.parse("2026-10-03T12:00:00Z")
const hour = 3_600_000
const feed: ReadonlyArray<FeedItem> = [
  { at: "2026-10-03T11:31:00Z", kind: "deploy", service: "checkout", text: "main-154 applied", version: "main-154" },
  { at: "2026-10-03T11:31:00Z", kind: "deploy", service: "web", text: "main-9 applied", version: "main-9" },
  { at: "2026-10-03T09:00:00Z", kind: "deploy", service: "checkout", text: "main-153 applied", version: "main-153" },
  { at: "2026-10-03T11:40:00Z", kind: "build", service: "checkout", text: "build passed: x" },
]
const slow: Alert = {
  id: "a1",
  name: "CheckoutSlow",
  state: "firing",
  severity: "warning",
  service: "checkout",
  startsAt: "2026-10-03T11:53:00Z",
  labels: {},
  notes: [],
}

describe("marks across a service's charts", () => {
  test("are its versions applied and its alerts fired, in the window, oldest first", () => {
    const marks = marksOf({ service: "checkout" }, feed, [slow, { ...slow, id: "p", state: "pending" }], [], {
      end,
      span: hour,
    })
    expect(marks.map((mark) => [mark.kind, mark.at])).toEqual([
      ["deploy", Date.parse("2026-10-03T11:31:00Z")],
      ["fired", Date.parse("2026-10-03T11:53:00Z")],
    ])
    expect(marks[0]?.label).toMatch(/^main-154 applied \d\d:31$/)
    expect(marks[1]?.label).toMatch(/^CheckoutSlow fired \d\d:53$/)
  })

  test("reach back as far as the window does, and take a store's ended alerts", () => {
    const ended = [
      {
        alert: "a8",
        name: "ReplicaLag",
        store: "orders-db",
        startsAt: "2026-10-03T08:00:00Z",
        endsAt: "2026-10-03T08:30:00Z",
      },
    ]
    expect(marksOf({ service: "checkout" }, feed, [], [], { end, span: 6 * hour })).toHaveLength(2)
    expect(marksOf({ store: "orders-db" }, feed, [], ended, { end, span: hour })).toEqual([])
    expect(marksOf({ store: "orders-db" }, feed, [], ended, { end, span: 6 * hour })).toMatchObject([{ kind: "fired" }])
  })
})
