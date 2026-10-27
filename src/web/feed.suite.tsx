/** @jsxImportSource solid-js */
/** What changed today as the overview draws it (spec 0068): run by `feed.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import type { FeedEvent } from "../shared/feed"
import { mount } from "./harness"
import { Feed } from "./parts/Feed"

const feed: FeedEvent = {
  items: [
    { at: "2026-10-03T10:53:00Z", kind: "alert", service: "checkout", text: "CheckoutSlow fired", alert: "a1" },
    ...["web", "checkout"].map((service) => ({
      at: "2026-10-03T10:41:00Z",
      kind: "build" as const,
      service,
      text: "build passed: Faster",
      url: `https://ci.example/${service}`,
      build: { title: "Faster", passed: true },
    })),
    ...["web", "checkout"].map((service) => ({
      at: "2026-10-03T10:31:00Z",
      kind: "deploy" as const,
      service,
      text: "main-2 applied",
      version: "main-2",
    })),
  ],
}

describe("what changed today", () => {
  test("says builds and versions that went out together as one line each, opening to them", () => {
    const page = mount(() => <Feed feed={feed} needing={new Set(["checkout"])} />)
    const lines = [...page.container.querySelectorAll(".feed > ol > li")]
    expect(lines).toHaveLength(3)
    expect(lines[0]?.textContent).toContain("22 min after checkout main-2 applied")
    expect(lines[0]?.classList.contains("feed-alert")).toBe(true)
    const builds = lines[1]?.querySelector("details")
    expect(builds?.querySelector("summary")?.textContent).toBe("2 builds passedcheckout: Faster, and 1 more")
    expect([...(builds?.querySelectorAll("li a") ?? [])].map((link) => link.getAttribute("href"))).toEqual([
      "https://ci.example/web",
      "https://ci.example/checkout",
    ])
    expect(lines[2]?.querySelector("summary")?.textContent).toBe("2 versions appliedincludes checkout main-2")
  })

  test("says a version that is a digest by its first 12 characters", () => {
    const digest = "743fb49a20393a43ea2b57a628414504a1e8baf536ef836d0981dec3c0839701"
    const item = { at: "2026-10-03T10:31:00Z", kind: "deploy" as const, service: "api", version: digest }
    const page = mount(() => (
      <Feed
        feed={{
          items: [
            { ...item, text: "x" },
            { ...item, service: "worker", text: "y" },
          ],
        }}
      />
    ))
    expect(page.container.querySelector("summary")?.textContent).toBe("2 versions appliedincludes api 743fb49a2039")
  })
})
