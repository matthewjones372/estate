/** @jsxImportSource solid-js */
/** The alert permalink: run by `alert.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { render } from "./harness"
import { AlertPage } from "./pages/Alert"

const text = (html: string) =>
  html
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")

describe("an alert's own page", () => {
  test("shows what's happening, what is around it, who owns it and Ask AI", () => {
    const page = text(render(() => <AlertPage id="a1" />))
    for (const words of [
      "What's happening",
      "OrdersSlow",
      "Around this alert",
      "Who owns it",
      "Ask AI is not configured",
    ])
      expect(page).toContain(words)
  })

  test("says an alert is not firing once the alerts are read, and waits for them before", () => {
    expect(text(render(() => <AlertPage id="missing" />))).toContain("missing is not firing in production now.")
    const { alerts: _, ...unread } = events
    expect(text(render(() => <AlertPage id="a1" />, { sent: unread }))).toContain("Reading the alerts…")
  })
})
