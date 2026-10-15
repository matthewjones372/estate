/** @jsxImportSource solid-js */
/** Notes that fold: run by `notes-fold.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import type { FeedEvent } from "../shared/feed"
import type { Note } from "../shared/note"
import { events } from "./fixture"
import { mount } from "./harness"
import { AlertCard } from "./parts/AlertCard"
import { Feed } from "./parts/Feed"
import { recording } from "./recording"

const alert = events.alerts.alerts[0] as Alert
const noted = (count: number): ReadonlyArray<Note> =>
  Array.from({ length: count }, (_, at) => ({
    id: `n${at}`,
    at: `2026-10-03T11:${String(50 - at).padStart(2, "0")}:00Z`,
    by: "gil",
    text: `note ${at}`,
  }))
/** A card on the alert's own page (level 2), or among others (the overview's, by default). */
const card =
  (notes: ReadonlyArray<Note>, level: 2 | 3 = 3) =>
  () => <AlertCard alert={{ ...alert, notes }} catalog={events.catalog} canSilence={false} level={level} />
const shownNotes = (container: HTMLElement) =>
  [...container.querySelectorAll(".note-body")].map((each) => each.textContent)
const answer =
  "Ask AI (m): The registry is slow.\n· errors rose from 0 to 0.9/s\n· adoption time went up\nNext: Check the registry\nConfidence: low"

const summary = (container: HTMLElement) => container.querySelector(".notes-line")?.textContent?.replace(/\s+/g, " ")
const box = (container: HTMLElement) => container.querySelector(".note-form input")

describe("notes on a card among others", () => {
  test("show as one line, the count and the latest, and Show notes opens the newest three and the box", () => {
    const { actions } = recording()
    const page = mount(card(noted(5)), { actions })
    expect(summary(page.container)).toMatch(/^Notes · 5 · latest: gil \S+ “note 0”/)
    expect(shownNotes(page.container)).toEqual([])
    expect(box(page.container)).toBeNull()
    const toggle = page.button("Show notes")
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    page.click(toggle)
    expect(shownNotes(page.container)).toEqual(["note 0", "note 1", "note 2"])
    expect(box(page.container)).not.toBeNull()
    expect(page.button("Hide notes").getAttribute("aria-expanded")).toBe("true")
  })

  test("keep Show notes on moving away and back", () => {
    const { actions } = recording()
    const page = mount(card(noted(5)), { actions })
    page.click(page.button("Show notes"))
    page.dispose()
    const again = mount(card(noted(5)), { actions })
    expect(shownNotes(again.container)).toEqual(["note 0", "note 1", "note 2"])
    expect(box(again.container)).not.toBeNull()
  })

  test("with none, say No notes yet and Add a note, which opens the box", () => {
    const page = mount(card([]))
    expect(summary(page.container)).toMatch(/^No notes yet · Add a note/)
    expect(box(page.container)).toBeNull()
    page.click(page.button("Add a note"))
    expect(box(page.container)).not.toBeNull()
  })
})

describe("notes on the alert's own page", () => {
  test("show open, the newest three and the box, with no line to open them", () => {
    const page = mount(card(noted(5), 2))
    expect(shownNotes(page.container)).toEqual(["note 0", "note 1", "note 2"])
    expect(box(page.container)).not.toBeNull()
    expect(page.container.querySelector(".notes-line")).toBeNull()
  })

  test("show the newest three and Show all, which is kept on moving away and back", () => {
    const { actions } = recording()
    const page = mount(card(noted(5), 2), { actions })
    expect(shownNotes(page.container)).toEqual(["note 0", "note 1", "note 2"])
    page.click(page.button("Show all 5 notes"))
    expect(shownNotes(page.container)).toHaveLength(5)
    page.dispose()
    const again = mount(card(noted(5), 2), { actions })
    expect(shownNotes(again.container)).toHaveLength(5)
    expect(again.button("Show fewer").getAttribute("aria-expanded")).toBe("true")
  })

  test("keep a note's lines as written, and show a long one's first two and more, which opens it", () => {
    const page = mount(card([{ id: "a", at: "2026-10-03T11:55:00Z", by: "matt", text: answer }], 2))
    const body = page.container.querySelector(".note-body")
    expect(body?.textContent).toBe(answer)
    expect(body?.classList.contains("clamped")).toBe(true)
    page.click(page.button(/^more/))
    expect(page.container.querySelector(".note-body")?.classList.contains("clamped")).toBe(false)
    expect(page.button(/^less/).getAttribute("aria-expanded")).toBe("true")
  })

  test("show the date of a note from before today, and only the time of today's", () => {
    const page = mount(
      card(
        [
          { id: "t", at: "2026-10-03T11:55:00Z", by: "matt", text: "today" },
          { id: "y", at: "2026-10-02T09:05:00Z", by: "gil", text: "yesterday" },
        ],
        2,
      ),
    )
    const stamps = [...page.container.querySelectorAll(".note .alert-quiet")].map((each) => each.textContent)
    expect(stamps[0]).not.toMatch(/Oct/)
    expect(stamps[1]).toMatch(/2 Oct/)
  })
})

describe("notes in what changed today", () => {
  test("show a long note's first two lines and more", () => {
    const feed: FeedEvent = {
      items: [{ at: "2026-10-03T11:55:00Z", kind: "note", who: "matt", text: answer }],
    } as unknown as FeedEvent
    const page = mount(() => <Feed feed={feed} />)
    expect(page.container.querySelector(".note-body")?.classList.contains("clamped")).toBe(true)
    page.click(page.button(/^more/))
    expect(page.container.querySelector(".note-body")?.classList.contains("clamped")).toBe(false)
  })
})
