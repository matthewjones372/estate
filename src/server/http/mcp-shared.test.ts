import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { settings } from "../fixture"
import { Configured } from "../settings"
import { estateOf, readsLogs } from "./mcp-shared"

describe("what /mcp's tools share", () => {
  test("an agent with no token in context reads as a viewer, the least it could be", () =>
    Effect.runPromise(readsLogs.pipe(Effect.provideService(Configured, settings({ logs: "operator" })))).then((reads) =>
      expect(reads).toBe(false),
    ))

  test("a tool called without the estate in context is a defect, not the agent's error", () =>
    Effect.runPromiseExit(estateOf).then((exit) => expect(Exit.hasDies(exit)).toBe(true)))
})
