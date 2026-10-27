import { describe, expect, test } from "bun:test"
import type { FollowedMessage } from "../shared/kafka-message"
import { caughtUp, followedMessage } from "./fixture-kafka"
import { followSaid, pathWords, stateWords } from "./kafka-message"

const unknown: FollowedMessage = {
  ...followedMessage,
  groups: [
    { name: "billing", state: "unknown" },
    { name: "orders-projector", state: "not yet", offset: 1_870_940, before: 1, seconds: null },
  ],
}

describe("a followed message in words", () => {
  test("says a group past it, and one whose offset is not known, in its path and on its card", () => {
    expect(pathWords(caughtUp, undefined).at(-1)).toBe(
      "orders-projector past it: at 1,882,400 on p0, but no span says a traced consumer handled it",
    )
    expect(pathWords(unknown, undefined).slice(2)).toEqual([
      "billing: its offset on p0 is not known",
      "orders-projector not yet: at 1,870,940 on p0, 1 messages before it, its rate is not known",
    ])
    expect(caughtUp.groups.map(stateWords)).toEqual(["read it · 888 ms after", "past it"])
    expect(unknown.groups.map(stateWords)).toEqual(["offset not known", "not yet · 1 before it"])
  })

  test("says when no group reads its topic, and which groups are short of it", () => {
    expect(followSaid({ ...followedMessage, groups: [] })).toBe("No group reads orders.")
    expect(followSaid(unknown)).toBe(
      "0 of 2 groups have read it; billing's offset is not known; orders-projector is 1 messages short.",
    )
  })
})
