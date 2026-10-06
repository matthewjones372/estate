import { describe, expect, test } from "bun:test"
import { catalog, environment, estate } from "../fixture"
import { followed, frameOf } from "./frames"

const before = estate({ environments: { production: environment(), staging: environment() } })

describe("the frames a follower is sent", () => {
  test("are the whole estate first, with the runner reading it", () => {
    expect(frameOf(undefined, before, "10.0.4.12:34431")).toEqual({
      _tag: "Whole",
      owner: "10.0.4.12:34431",
      estate: before,
    })
  })

  test("then only what changed, by environment and part", () => {
    const production = before.environments["production"] ?? environment()
    const now = {
      ...before,
      notes: [
        { id: "n1", environment: "production", alert: "a", at: "2026-10-06T00:00:00Z", by: "Ada", text: "on it" },
      ],
      environments: {
        ...before.environments,
        production: { ...production, alerts: { state: "ok" as const, value: [] } },
      },
    }
    const frame = frameOf(before, now, "a")
    expect(frame).toEqual({
      _tag: "Changed",
      environments: { production: { alerts: { state: "ok", value: [] } } },
      notes: now.notes,
    })
    expect(followed(before, frame)).toEqual(now)
  })

  test("are whole again when the catalog or its environments change", () => {
    const fewer = { ...before, environments: { production: environment() } }
    expect(frameOf(before, fewer, "a")._tag).toBe("Whole")
    expect(frameOf(before, { ...before, catalog: { ...catalog } }, "a")._tag).toBe("Whole")
    expect(followed(before, frameOf(before, fewer, "a"))).toEqual(fewer)
  })

  test("say nothing when nothing changed", () => {
    expect(frameOf(before, before, "a")).toEqual({ _tag: "Changed", environments: {} })
  })
})
