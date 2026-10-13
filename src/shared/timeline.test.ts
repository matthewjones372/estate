import { describe, expect, test } from "bun:test"
import { type EventKind, type FiringEvent, mergedOnce, said, seenBy } from "./timeline"

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
      line("incident-noted", "registry restarted"),
      line("incident-note-removed", "a note by ada: registry restarted"),
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
      "noted on the incident: registry restarted",
      "removed from the incident a note by ada: registry restarted",
    ])
  })
})

describe("an incident's merged events", () => {
  const event = (id: string, at: string, kind: EventKind, text: string) => ({ id, at, by: "gil", kind, text })

  test("are in time order, with an event on the incident shown once however many firings kept it", () => {
    const merged = mergedOnce([
      event("b", "2026-10-02T09:05:00.000Z", "incident-noted", "restarted"),
      event("a", "2026-10-02T09:00:00Z", "fired", "warning, orders"),
      event("c", "2026-10-02T09:05:00Z", "incident-noted", "restarted"),
      event("d", "2026-10-02T09:05:00Z", "incident-noted", "and again"),
      event("e", "2026-10-02T09:06:00Z", "noted", "same"),
      event("f", "2026-10-02T09:06:00Z", "noted", "same"),
    ])
    expect(merged.map((each) => each.id)).toEqual(["a", "b", "d", "e", "f"])
  })
})

describe("the events as a reader may see them", () => {
  const answered = (id: string, readLogs?: boolean): FiringEvent => ({
    id,
    at: "2026-10-12T16:49:52Z",
    by: "Estate",
    kind: "ai-answered",
    text: "lock timeout on orders_items (medium)",
    ...(readLogs === undefined ? {} : { readLogs }),
  })
  const asked: FiringEvent = { id: "q", at: "2026-10-12T16:49:10Z", by: "matt", kind: "ai-asked", text: "claude" }
  const events = [asked, answered("logs", true), answered("none", false), answered("old")]

  test("keep only that an answer drawn from logs was, for one who may not read logs", () => {
    const seen = seenBy(events, false)
    expect(seen.map(said)).toEqual([
      "asked AI (claude)",
      "AI answered from logs only operators read",
      "AI answered: lock timeout on orders_items (medium)",
      // An answer kept before it was marked is withheld rather than guessed safe.
      "AI answered from logs only operators read",
    ])
    expect(seen[1]).toEqual({ ...answered("logs", true), text: "", withheld: true })
  })

  test("are whole for one who may read logs", () => expect(seenBy(events, true)).toEqual(events))
})
