import { describe, expect, test } from "bun:test"
import type { Write } from "./cluster/wire"
import { environment, estate } from "./fixture"
import type { SourcedAlert } from "./state"
import { applied } from "./writes"

const at = Date.parse("2026-10-06T00:00:00Z")
const alert: SourcedAlert = {
  id: "a1",
  name: "HighErrorRate",
  state: "firing",
  severity: "critical",
  startsAt: "2026-10-05T23:00:00Z",
  labels: {},
}
const silence = {
  id: "s1",
  by: "Ada",
  reason: "deploying",
  startsAt: "2026-10-06T00:00:00Z",
  endsAt: "2026-10-06T01:00:00Z",
}
const start = estate({
  environments: {
    production: environment({
      alerts: { state: "ok", value: [alert] },
      cluster: { state: "ok", value: { pods: {}, debug: {} } },
    }),
  },
})

const after = (...writes: ReadonlyArray<Write>) => writes.reduce((state, write) => applied(write)(state), start)

describe("a write", () => {
  test("adds and removes a note", () => {
    const note = {
      id: "n1",
      environment: "production",
      alert: "a1",
      at: "2026-10-06T00:00:00Z",
      by: "Ada",
      text: "on it",
    }
    expect(after({ _tag: "NoteAdded", note }).notes).toEqual([note])
    expect(after({ _tag: "NoteAdded", note }, { _tag: "NoteRemoved", id: "n1" }).notes).toEqual([])
  })

  test("sets an impact in place of the last, and clears it", () => {
    const impact = { alert: "HighErrorRate", text: "checkout fails", by: "Ada", at: "2026-10-06T00:00:00Z" }
    const twice = after({ _tag: "ImpactSet", impact }, { _tag: "ImpactSet", impact: { ...impact, text: "slow" } })
    expect(twice.impacts?.map((each) => each.text)).toEqual(["slow"])
    expect(after({ _tag: "ImpactSet", impact }, { _tag: "ImpactCleared", alert: "HighErrorRate" }).impacts).toEqual([])
  })

  test("holds a silence on its alert until the manager agrees, and its end", () => {
    const held = after({ _tag: "Held", environment: "production", alert: "a1", silence, at })
    expect(held.environments["production"]?.alerts.value?.[0]?.state).toBe("silenced")
    const ended = applied({ _tag: "Unheld", environment: "production", id: "s1", at })(held)
    expect(ended.environments["production"]?.alerts.value?.[0]?.state).toBe("firing")
    expect(after({ _tag: "Held", environment: "production", alert: "gone", silence, at })).toEqual(start)
    expect(after({ _tag: "Held", environment: "elsewhere", alert: "a1", silence, at })).toEqual(start)
  })

  test("keeps a thread and shows a service's debug", () => {
    const thread = {
      environment: "production",
      alert: "a1",
      startsAt: alert.startsAt,
      channel: "C1",
      ts: "1.2",
      url: "https://slack",
    }
    expect(after({ _tag: "ThreadKept", thread }).threads).toEqual([thread])
    const debug = { level: "debug", on: true, since: "2026-10-06T00:00:00Z", until: "2026-10-06T01:00:00Z", by: "Ada" }
    const shown = after({ _tag: "DebugShown", environment: "production", service: "storefront", debug })
    expect(shown.environments["production"]?.cluster.value?.debug["storefront"]).toEqual(debug)
  })
})
