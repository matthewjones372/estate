/** @jsxImportSource solid-js */
/** A past firing's page, and the links to it, in happy-dom: run by `firing.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { Events } from "../shared/events"
import { App } from "./App"
import { events, heard, now, operator } from "./fixture"
import { mount } from "./harness"
import { AlertPage } from "./pages/Alert"
import { Alerts } from "./pages/Alerts"
import { FiringPage } from "./pages/Firing"
import { AroundThen } from "./parts/AroundThen"
import { Timeline } from "./parts/Charts"
import { Feed } from "./parts/Feed"
import { History } from "./parts/History"
import { ErrorList } from "./parts/LogErrors"
import { recording } from "./recording"

const links = (container: HTMLElement) =>
  [...container.querySelectorAll("a")].map((each) => [each.textContent?.trim(), each.getAttribute("href")])

describe("a past firing's page", () => {
  test("says what happened: when and for how long, what it said, its silence, notes, impact and runbook", async () => {
    const page = mount(() => <FiringPage id="a1" at="2026-10-02T09:00:00Z" />)
    await page.settle()
    const text = page.container.textContent ?? ""
    expect(text).toContain("What happened")
    expect(text).toContain("critical · fired ")
    expect(text).toContain(" for 22 min, ended ")
    expect(text).toContain(" · storefront · production")
    expect(text).toContain("Orders are slow")
    expect(text).toContain("Orders take seconds to place.")
    expect(text).toContain("Silenced by gil: “vacuum”")
    expect(text).toContain("“Restarted the pool.” — ada")
    expect(page.calls).toContainEqual(["firing", "a1", "2026-10-02T09:00:00Z"])
    expect(links(page.container)).toContainEqual(["Open the runbook", "https://runbooks.example/orders-slow"])
    expect(links(page.container).map(([, href]) => href)).toContain("/alerts/a1/2026-09-20T14:02:00Z")
  })

  test("is the page the app draws for a firing's address", async () => {
    const { actions } = recording()
    const at = "2026-10-02T09:00:00Z"
    const estate = {
      live: heard(),
      me: operator,
      actions,
      now: () => now,
      page: () => ({ page: "firing" as const, id: "a1", at }),
    }
    const page = mount(() => <App estate={estate} />)
    await page.settle()
    expect(page.container.textContent).toContain("What happened")
  })

  test("says what changed in the hour before it fired, what is not known, and what sits around it", async () => {
    const page = mount(() => <FiringPage id="a1" at="2026-10-02T09:00:00Z" />)
    await page.settle()
    const text = page.container.textContent ?? ""
    expect(text).toContain("Around it then")
    expect(text).toContain("orders main-88 deployed")
    expect(text).toContain("Deploys of storefront before main-212 are not kept here.")
    expect(links(page.container)).toContainEqual(["orders", "/services/orders"])
  })

  test("says when nothing it holds changed before it, and names each neighbour", () => {
    const neighbours = [
      { name: "orders", kind: "service" as const, side: "calls" as const },
      { name: "orders-db", kind: "store" as const, side: "calls" as const },
    ]
    const page = mount(() => <AroundThen around={{ changed: [], unseen: [], neighbours }} />)
    expect(page.container.textContent).toContain("Nothing Estate holds changed in the hour before it fired.")
    expect(page.container.textContent).toContain("Aroundorders, orders-db")
    expect(links(page.container)).toEqual([
      ["orders", "/services/orders"],
      ["orders-db", "/stores/orders-db"],
    ])
  })

  test("shows its service's errors from ten minutes before it fired until it ended", async () => {
    const page = mount(() => <FiringPage id="a1" at="2026-10-02T09:00:00Z" />)
    await page.settle()
    await page.settle()
    expect(page.container.textContent).toContain("Errors then")
    expect(page.container.textContent).toContain("ERROR order ‹n› lost")
    expect(page.calls).toContainEqual([
      "errors",
      "storefront",
      { since: "2026-10-02T08:50:00.000Z", until: "2026-10-02T09:22:00Z" },
    ])
  })

  test("charts its service's load from an hour before it fired to an hour after it ended, the firing shaded", async () => {
    const page = mount(() => <FiringPage id="a1" at="2026-10-02T09:00:00Z" />)
    await page.settle()
    await page.settle()
    expect(page.container.textContent).toContain("Load then")
    expect(page.calls).toContainEqual([
      "loadBetween",
      "storefront",
      "2026-10-02T08:00:00.000Z",
      "2026-10-02T10:22:00.000Z",
    ])
    expect(page.container.querySelectorAll(".plot-firing")).toHaveLength(3)
  })

  test("says when its errors come from pods that may have started since", async () => {
    const actions = {
      ...recording().actions,
      errors: () => Promise.resolve({ from: "the cluster", groups: [] }),
    }
    const window = { since: "2026-10-02T08:50:00Z", until: "2026-10-02T09:22:00Z" }
    const page = mount(() => <ErrorList service="storefront" window={window} />, { actions })
    await page.settle()
    expect(page.container.textContent).toContain("Read from the pods running now")
  })

  test("says when a firing is not kept, or was kept before Estate kept what its alert said", async () => {
    const gone = mount(() => <FiringPage id="a9" at="2026-10-02T09:00:00Z" />)
    await gone.settle()
    expect(gone.container.textContent).toContain("is not kept here")
    const bare = mount(() => <FiringPage id="a1" at="2026-09-20T14:02:00Z" />)
    await bare.settle()
    expect(bare.container.textContent).toContain("Kept before Estate kept what an alert said")
  })

  test("is where an alert's page points once it no longer fires", async () => {
    const page = mount(() => <AlertPage id="a1" />, { sent: { ...events, alerts: { ...events.alerts, alerts: [] } } })
    await page.settle()
    expect(links(page.container)).toContainEqual([
      expect.stringContaining("Its last firing"),
      "/alerts/a1/2026-10-02T09:00:00Z",
    ])
  })
})

describe("a past firing is a click away", () => {
  test("from each row of an alert's History", async () => {
    const alert = events.alerts?.alerts[0]
    if (alert === undefined) throw new Error("no alert")
    const page = mount(() => (
      <History alert={{ ...alert, history: [{ startsAt: "2026-10-02T09:00:00Z", notes: [] }] }} />
    ))
    page.click(page.button("History"))
    await page.settle()
    expect(links(page.container).map(([, href]) => href)).toEqual(["/alerts/a1/2026-10-02T09:00:00Z"])
  })

  test("from what resolved today, the day's timeline and the feed", () => {
    const resolved = mount(() => <Alerts />)
    expect(links(resolved.container).map(([, href]) => href)).toContain("/alerts/a7/2026-10-03T08:00:00Z")
    const timeline = mount(() => (
      <Timeline
        now={Date.parse("2026-10-03T12:00:00Z")}
        alerts={[
          { id: "a1", name: "OrdersSlow", startsAt: "2026-10-03T11:46:00Z" },
          { id: "a7", name: "Restarted", startsAt: "2026-10-03T08:00:00Z", endsAt: "2026-10-03T08:08:00Z" },
        ]}
      />
    ))
    expect(links(timeline.container)).toEqual([
      ["OrdersSlow", "/alerts/a1"],
      ["Restarted", "/alerts/a7/2026-10-03T08:00:00Z"],
    ])
    const feed: Events["feed"] = {
      items: [
        {
          at: "2026-10-03T08:08:00Z",
          kind: "resolved",
          service: "orders",
          text: "Restarted resolved",
          firing: { alert: "a7", startsAt: "2026-10-03T08:00:00Z" },
        },
      ],
    }
    expect(links(mount(() => <Feed feed={feed} />).container)).toContainEqual([
      "orders Restarted resolved",
      "/alerts/a7/2026-10-03T08:00:00Z",
    ])
  })
})
