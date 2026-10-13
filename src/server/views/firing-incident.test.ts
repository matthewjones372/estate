import { describe, expect, test } from "bun:test"
import type { Incident } from "../../shared/incidents"
import { estate } from "../fixture"
import { pastFiring } from "./firing"

const kept = { environment: "staging", alert: "a1", name: "OrdersSlow" }
const linked = (startsAt: string) => ({ ...kept, startsAt, linkedBy: "gil", linkedAt: startsAt })
const slow: Incident = {
  id: "i1",
  title: "Orders slow",
  openedBy: "gil",
  openedAt: "2026-10-03T09:05:00Z",
  // Kept as Alertmanager wrote the start; the store reads the firing back with its milliseconds.
  firings: [linked("2026-10-03T09:00:00Z")],
  notes: [{ id: "n1", at: "2026-10-03T09:20:00Z", by: "ada", text: "the pool was resized" }],
}
const state = estate({
  firings: [
    { ...kept, startsAt: "2026-10-03T09:00:00.000Z", endsAt: "2026-10-03T09:30:00.000Z" },
    { ...kept, startsAt: "2026-10-02T09:00:00.000Z", endsAt: "2026-10-02T09:30:00.000Z" },
  ],
  notes: [{ id: "m1", environment: "staging", alert: "a1", at: "2026-10-03T09:10:00.000Z", by: "gil", text: "on it" }],
  incidents: [slow],
})

describe("a past firing's page", () => {
  test("has the notes of the incident it was in, each naming it, among its own, newest first", () => {
    const firing = pastFiring(state, "staging", "a1", "2026-10-03T09:00:00Z")
    expect(firing?.incident).toEqual({ id: "i1", title: "Orders slow", closed: false })
    expect(firing?.notes).toEqual([
      {
        id: "n1",
        at: "2026-10-03T09:20:00Z",
        by: "ada",
        text: "the pool was resized",
        incident: { id: "i1", title: "Orders slow" },
      },
      { id: "m1", at: "2026-10-03T09:10:00.000Z", by: "gil", text: "on it" },
    ])
  })

  test("of a firing in no incident has neither", () => {
    const firing = pastFiring(state, "staging", "a1", "2026-10-02T09:00:00Z")
    expect(firing?.incident).toBeUndefined()
    expect(firing?.notes).toEqual([])
  })
})
