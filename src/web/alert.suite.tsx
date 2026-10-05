/** @jsxImportSource solid-js */
/** The alert permalink: run by `alert.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { render } from "./harness"
import { AlertPage } from "./pages/Alert"

const text = (html: string) =>
  html
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")

describe("an alert permalink", () => {
  test("shows what's happening, what changed, ownership and Ask AI", () => {
    const page = text(render(() => <AlertPage id="a1" />))
    for (const words of [
      "What's happening",
      "OrdersSlow",
      "What changed",
      "Around this alert",
      "Who owns it",
      "Environment",
      "Where to investigate",
      "Ask AI",
      "Ask AI is not configured",
    ]) {
      expect(page).toContain(words)
    }
    expect(text(render(() => <AlertPage id="missing" />))).toContain("There is no alert missing")
  })
})
