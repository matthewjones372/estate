import { describe, expect, test } from "bun:test"
import { followedMessage } from "./fixture-kafka"
import { followSaid, pathWords, stateWords } from "./kafka-message"

const unknown = {
  ...followedMessage,
  groups: [...followedMessage.groups, { name: "billing", state: "unknown" as const }],
}

describe("a followed message in words", () => {
  test("a group whose offset is not known says so on its step and its card", () => {
    expect(pathWords(unknown, undefined).at(-1)).toBe("billing: its offset on p0 is not known")
    expect(stateWords({ name: "billing", state: "unknown" })).toBe("offset not known")
  })

  test("a group that read it says how long after it was written", () => {
    expect(stateWords({ name: "audit", state: "read", service: "audit-sink", at: 0, after: 888 })).toBe(
      "read it · 888 ms after",
    )
  })

  test("a follow short of a group whose offset is not known names it", () => {
    expect(followSaid(unknown)).toBe(
      "1 of 3 groups has read it; orders-projector is 11,400 messages short; billing's offset is not known.",
    )
  })
})
