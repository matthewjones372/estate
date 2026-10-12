import { describe, expect, test } from "bun:test"
import { type EventKind, said } from "./timeline"

const line = (kind: EventKind, text: string) => said({ id: "e", at: "2026-10-02T09:00:00Z", by: "gil", kind, text })

describe("what an event says in a line", () => {
  test("names what was done, then what it said, the same on the page and in an export", () => {
    expect([
      line("fired", "warning, orders"),
      line("resolved", "after 22 min"),
      line("noted", "Pool at 100%"),
      line("note-removed", 'a note by ada: "Pool at 100%"'),
      line("silenced", "for 1 hour: vacuum"),
      line("unsilenced", "lifted the silence"),
      line("impact-written", "Orders take seconds"),
      line("team-told", "told Orders on Slack"),
      line("ai-asked", "claude-haiku-4-5"),
      line("ai-answered", "The pool is exhausted. (medium)"),
      line("ai-failed", "the model timed out"),
      line("ai-kept", "The pool is exhausted."),
      line("incident-opened", "Orders slow"),
      line("incident-linked", "Orders slow"),
      line("incident-unlinked", "Orders slow"),
      line("incident-closed", "the pool was resized"),
    ]).toEqual([
      "fired: warning, orders",
      "resolved after 22 min",
      "noted: Pool at 100%",
      'removed a note by ada: "Pool at 100%"',
      "silenced for 1 hour: vacuum",
      "lifted the silence",
      "wrote the impact: Orders take seconds",
      "told Orders on Slack",
      "asked AI (claude-haiku-4-5)",
      "AI answered: The pool is exhausted. (medium)",
      "AI could not answer: the model timed out",
      "kept the AI's answer as a note: The pool is exhausted.",
      'opened incident "Orders slow" with this firing',
      'linked to incident "Orders slow"',
      'unlinked from incident "Orders slow"',
      "closed the incident: the pool was resized",
    ])
  })
})
