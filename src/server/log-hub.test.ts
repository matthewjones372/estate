import { describe, expect, test } from "bun:test"
import { unsent } from "./log-hub"

const line = (at: string, text: string, pod = "4f1c") => ({ at: `2026-10-27T11:59:${at}.000Z`, pod, text })

describe("a reader that reads a little behind the last line it sent", () => {
  test("sends a line that came late once, and none it sent before", () => {
    const sent = [line("50", "INFO one"), line("52", "INFO two")]
    const read = [line("50", "INFO one"), line("51", "INFO late"), line("52", "INFO two"), line("53", "INFO three")]
    expect(unsent(sent, read)).toEqual([line("51", "INFO late"), line("53", "INFO three")])
  })

  test("tells apart the same text at the same time from another task", () => {
    expect(unsent([line("50", "INFO tick")], [line("50", "INFO tick", "9a2e")])).toEqual([
      line("50", "INFO tick", "9a2e"),
    ])
  })
})
