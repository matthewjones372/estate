/** @jsxImportSource solid-js */
/** The alert permalink: run by `alert.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { mount, render } from "./harness"
import { AlertPage } from "./pages/Alert"

const text = (html: string) =>
  html
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")

describe("an alert's own page", () => {
  test("shows what's happening, what is around it and who owns it", () => {
    const page = text(render(() => <AlertPage id="a1" />))
    for (const words of ["What's happening", "OrdersSlow", "Around this alert", "Who owns it"])
      expect(page).toContain(words)
  })

  test("links the service it is about to its page, beside the card's title and in what's happening", () => {
    const page = mount(() => <AlertPage id="a1" />)
    const to = (selector: string) => page.container.querySelector(`${selector} a`)?.getAttribute("href")
    expect(to(".lede")).toBe("/services/storefront")
    expect(to(".alert-card .alert-detail")).toBe("/services/storefront")
  })

  test("says an alert is not firing once the alerts are read, and waits for them before", () => {
    expect(text(render(() => <AlertPage id="missing" />))).toContain("missing is not firing in production now.")
    const { alerts: _, ...unread } = events
    expect(text(render(() => <AlertPage id="a1" />, { sent: unread }))).toContain("Reading the alerts…")
  })
})
