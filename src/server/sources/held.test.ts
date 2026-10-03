import { describe, expect, test } from "bun:test"
import { environment } from "../fixture"
import type { EnvironmentState, SourcedAlert } from "../state"
import { holdSilence, holdUnsilence, keepHeld } from "./held"

const now = Date.parse("2026-10-03T12:00:00Z")
const second = (seconds: number) => new Date(now + seconds * 1000).toISOString()

const pending: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "pending",
  severity: "warning",
  startsAt: "",
  labels: {},
}
const silence = { id: "s1", by: "gil", reason: "vacuum", startsAt: "", endsAt: "" }

const withAlerts = (alerts: ReadonlyArray<SourcedAlert>, state = environment()): EnvironmentState => ({
  ...state,
  alerts: { state: "ok", value: alerts },
})

/** What the page shows of the alert after a read of the alerts answers `read` at `at`. */
const afterRead = (state: EnvironmentState, read: ReadonlyArray<SourcedAlert>, at: string) =>
  keepHeld(withAlerts(read, state), at)

describe("a silence Estate writes", () => {
  test("stays on the page through reads that do not have it yet, and is let go once one does", () => {
    const silenced = holdSilence(withAlerts([pending]), pending, silence, now)
    const early = afterRead(silenced, [pending], second(30))
    expect(early.alerts.value?.[0]).toMatchObject({ state: "silenced", silence: { id: "s1" } })
    const confirmed = afterRead(early, [{ ...pending, state: "silenced", silence }], second(60))
    expect(confirmed.held).toEqual([])
  })

  test("is let go after two minutes whatever the manager says, or when the alert has gone", () => {
    const silenced = holdSilence(withAlerts([pending]), pending, silence, now)
    expect(afterRead(silenced, [pending], second(121)).alerts.value?.[0]?.state).toBe("pending")
    expect(afterRead(silenced, [], second(30)).held).toEqual([])
  })

  test("ended, puts the alert back as it was before: pending if it was, firing if Estate did not silence it", () => {
    const silenced = afterRead(holdSilence(withAlerts([pending]), pending, silence, now), [pending], second(10))
    const ended = holdUnsilence(silenced, "s1", now + 20_000)
    expect(ended.alerts.value?.[0]).toEqual(pending)
    const stale = afterRead(ended, [{ ...pending, state: "silenced", silence }], second(30))
    expect(stale.alerts.value?.[0]).toEqual(pending)

    const theirs = withAlerts([{ ...pending, state: "silenced", silence: { ...silence, id: "s9" } }])
    expect(holdUnsilence(theirs, "s9", now).alerts.value?.[0]).toEqual({ ...pending, state: "firing" })
    expect(holdUnsilence(theirs, "s-other", now)).toEqual(theirs)
  })

  test("leaves a read alone when nothing is held", () => {
    const read = withAlerts([pending])
    expect(keepHeld(read, second(0))).toBe(read)
  })
})
