/** @jsxImportSource solid-js */
/** Around this alert on the page: run by `around-ui.test.ts`. */
import { describe, expect, test } from "bun:test"
import type { Alert } from "../shared/events"
import { events } from "./fixture"
import { render } from "./harness"
import { Around, AroundLine } from "./parts/Around"

const text = (html: string) =>
  html
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")

const alert = events.alerts.alerts[0] as Alert

describe("Around this alert on the page", () => {
  test("lists deploys and builds near the firing", () => {
    const page = text(render(() => <Around alert={alert} />))
    expect(page).toContain("Around this alert")
    expect(page).toContain("deployed")
    expect(page).toContain("before it fired")
  })

  test("says when nothing changed in the hour before", () => {
    const early = { ...alert, startsAt: "2026-10-03T08:00:00Z" }
    const page = text(render(() => <Around alert={early} />))
    expect(page).toContain("No deploys or builds")
  })

  test("handles an alert with no service", () => {
    const { service: _, ...bare } = alert
    const page = text(render(() => <Around alert={bare as Alert} />))
    expect(page).toContain("No service is named")
  })

  test("AroundLine summarises the nearest change on a card", () => {
    const page = text(render(() => <AroundLine alert={alert} />))
    expect(page).toContain("before it fired")
    const early = { ...alert, startsAt: "2026-10-03T08:00:00Z" }
    expect(text(render(() => <AroundLine alert={early} />))).toContain("No deploys in the hour before")
  })
})
