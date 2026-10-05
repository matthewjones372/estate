/** @jsxImportSource solid-js */
/** The overview's lanes in happy-dom: grouped by category, and a job's: run by `lanes.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"
import { scaled, shareOf } from "./parts/AgentLane"
import { chatOf, teamOf } from "./teams"

describe("an overview of a catalog with categories", () => {
  test("puts each category's lanes under its heading, in the catalog's order, and the rest last", () => {
    const catalog = events.catalog
    if (catalog === undefined) throw new Error("no catalog")
    const page = mount(() => <Overview />, {
      sent: {
        ...events,
        catalog: {
          ...catalog,
          services: [
            { ...catalog.services[1], name: "orders", links: [], category: "Payments" },
            { ...catalog.services[0], name: "storefront", links: [] },
          ],
          stores: [{ name: "orders-db", engine: "postgres", links: [], category: "Payments" }],
        },
      },
    })
    const groups = [...page.container.querySelectorAll(".lanes-group")].map((group) => [
      group.querySelector("h2")?.textContent,
      [...group.querySelectorAll(".lane .lane-name, .lane a.mono")].length,
    ])
    expect(groups.map(([title]) => title)).toEqual(["Payments", "Everything else"])
    expect(page.container.querySelector('[aria-label="The estate by area"]')).not.toBeNull()
    expect(page.container.textContent).not.toContain("Stores")
  })
})

describe("a job no service owns", () => {
  test("has a lane: its health and why, its schedule and next run, and its last runs", () => {
    const catalog = events.catalog
    if (catalog === undefined || events.services === undefined) throw new Error("no catalog")
    const page = mount(() => <Overview />, {
      sent: {
        ...events,
        catalog: {
          ...catalog,
          jobs: [
            { name: "settle", kind: "CronJob", links: [] },
            { name: "export", kind: "ScheduledTask", links: [] },
          ],
        },
        services: {
          ...events.services,
          jobs: [
            {
              name: "settle",
              health: "attention",
              reasons: ["its last run failed: BackoffLimitExceeded"],
              job: {
                name: "nightly-settle",
                kind: "CronJob",
                schedule: "0 2 * * *",
                suspended: false,
                next: "2026-10-04T02:00:00Z",
                runs: [
                  {
                    name: "r1",
                    outcome: "failed",
                    startedAt: "2026-10-03T02:00:00Z",
                    finishedAt: "2026-10-03T02:01:00Z",
                    message: "BackoffLimitExceeded",
                  },
                ],
              },
            },
            {
              name: "export",
              health: "healthy",
              reasons: [],
              job: { name: "export", kind: "ScheduledTask", suspended: false, runs: [] },
            },
          ],
        },
      },
    })
    const settle = page.container.querySelector('[aria-label="settle, a job"]')
    expect(settle?.textContent).toContain("its last run failed: BackoffLimitExceeded")
    expect(settle?.textContent).toContain("0 2 * * *")
    expect(settle?.textContent).toContain("next at")
    expect(settle?.querySelectorAll(".job-run")).toHaveLength(1)
    expect(page.container.querySelector('[aria-label="export, a job"]')?.textContent).toContain("no runs kept")
    expect([...page.container.querySelectorAll("h2")].map((heading) => heading.textContent)).toContain("Jobs")
  })
})

describe("the map of a large estate", () => {
  test("is a node a category, which opens in place and closes again", async () => {
    const catalog = events.catalog
    if (catalog === undefined) throw new Error("no catalog")
    const names = Array.from({ length: 14 }, (_, index) => [`svc-${index}`, index < 7 ? "Shop" : "Data"] as const)
    const page = mount(() => <Overview />, {
      sent: {
        ...events,
        catalog: {
          ...catalog,
          services: names.map(([name, category]) => ({ name, links: [], category })),
          map: {
            nodes: names.map(([name]) => ({ id: name, title: name, kind: "service", service: name })),
            edges: [{ from: "svc-0", to: "svc-7" }],
          },
        },
      },
    })
    const nodes = () => [...page.container.querySelectorAll(".map-node")].map((node) => node.textContent?.trim())
    expect(nodes()).toEqual(["Shop7 nodes", "Data7 nodes"])
    page.click(page.button(/^Data/))
    await page.settle()
    expect(nodes()).toHaveLength(8)
    page.click(page.button("Close Data"))
    await page.settle()
    expect(nodes()).toHaveLength(2)
  })
})

describe("a team", () => {
  test("is named by its title where it owns something, with its links, and its chat on its alerts' cards", () => {
    const catalog = events.catalog
    if (catalog === undefined) throw new Error("no catalog")
    const teams = [
      {
        name: "web",
        title: "Web",
        links: [
          { name: "slack", url: "https://slack.example/web" },
          { name: "confluence", url: "https://wiki.example/web" },
          { name: "oncall", url: "https://pager.example/web" },
        ],
      },
    ]
    const sent = {
      ...events,
      catalog: {
        ...catalog,
        teams,
        services: catalog.services.map((service) => ({ ...service, owner: "web" })),
        jobs: [{ name: "settle", kind: "CronJob" as const, links: [], owner: "web" }],
      },
    }
    const page = mount(() => <Overview />, { sent })
    const cards = [...page.container.querySelectorAll(".alert-card a")].map((link) => link.textContent?.trim())
    expect(cards).toContain("Web on Slack")
    const owner = page.container.querySelector('[aria-label="settle, a job"] .owner')
    expect(owner?.textContent).toContain("Owned by Web")
    expect([...(owner?.querySelectorAll("a") ?? [])].map((link) => link.textContent?.trim())).toEqual([
      "Slack",
      "Confluence",
      "On call",
    ])
    expect(chatOf(teamOf(sent.catalog, "web"))).toEqual({ url: "https://slack.example/web", text: "Web on Slack" })
    expect(chatOf({ name: "x", title: "X", links: [{ name: "teams", url: "https://teams.example" }] })?.text).toBe(
      "X on Teams",
    )
    expect([chatOf(undefined), teamOf(sent.catalog, undefined), teamOf(undefined, "web")]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })
})

describe("an agent", () => {
  test("has a lane: its health, model and since when, its tokens against its budget, its usage and its team", () => {
    const catalog = events.catalog
    if (catalog === undefined || events.services === undefined) throw new Error("no catalog")
    const series = (now: number) => ({ now, points: [now, now] })
    const page = mount(() => <Overview />, {
      sent: {
        ...events,
        catalog: {
          ...catalog,
          agents: [
            { name: "triage", links: [], owner: "web", budget: { tokens: 20_000_000, per: "day" } },
            { name: "summariser", links: [], budget: { tokens: 1_000_000, per: "month" } },
          ],
          teams: [{ name: "web", title: "Web", links: [] }],
        },
        services: {
          ...events.services,
          agents: [
            {
              name: "triage",
              health: "attention",
              reasons: ["on course for 24M tokens a day, over its 20M"],
              usage: {
                runs: series(4),
                tokens: series(1_000_000),
                spent: 6_100_000,
                model: "claude-b",
                modelSince: "2026-10-03T11:00:00Z",
              },
              pods: [{ name: "p0", ready: true }],
            },
            { name: "summariser", health: "healthy", reasons: [], usage: {} },
          ],
        },
      },
    })
    const triage = page.container.querySelector('[aria-label="triage, an agent"]')?.textContent ?? ""
    expect(triage).toContain("on course for 24M tokens a day")
    expect(triage).toContain("claude-b · since")
    expect(triage).toContain("1/1 pods")
    expect(triage).toContain("6.1M of 20M tokens today")
    expect(triage).toContain("Owned by Web")
    const summariser = page.container.querySelector('[aria-label="summariser, an agent"]')?.textContent ?? ""
    expect(summariser).toContain("model not read")
    expect(summariser).toContain("budget 1M tokens a month")
    expect([...page.container.querySelectorAll("h2")].map((heading) => heading.textContent)).toContain("Agents")
  })

  test("says its runs a minute, its failing as a share of its runs, and its tokens in thousands", () => {
    const runs = { now: 0.25, points: [0.25, 0, null] }
    expect(scaled(runs, 60)).toEqual({ now: 15, points: [15, 0, null] })
    expect(shareOf({ now: 0.01, points: [0.01, 0.01, 0.01] }, runs)).toEqual({ now: 4, points: [4, null, null] })
    expect([scaled(undefined, 60), shareOf(undefined, runs), shareOf(runs, undefined)]).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(shareOf({ now: null, points: [] }, runs)?.now).toBeNull()
  })
})

describe("the services layout", () => {
  test("defaults to list lanes, and switches to a grid of services", () => {
    const page = mount(() => <Overview />)
    expect(page.container.querySelector('a.lane-title[href*="storefront"]')).not.toBeNull()
    expect(page.container.querySelector(".service-grid")).toBeNull()
    page.click(page.button("Grid"))
    expect(page.container.querySelector(".service-grid")).not.toBeNull()
    expect(page.container.querySelector('a.lane-title[href*="storefront"]')).toBeNull()
    expect(page.container.textContent).toContain("storefront")
    expect(page.container.textContent).toContain("orders")
    expect(page.container.querySelector('.service-card[href*="storefront"]')).not.toBeNull()
    page.click(page.button("List"))
    expect(page.container.querySelector('a.lane-title[href*="storefront"]')).not.toBeNull()
    expect(page.container.querySelector(".service-grid")).toBeNull()
  })

  test("keeps the grid choice in this browser", () => {
    const held = new Map<string, string>()
    const prior = Object.getOwnPropertyDescriptor(globalThis, "window")
    Object.defineProperty(globalThis, "window", {
      value: {
        ...globalThis.window,
        localStorage: {
          getItem: (key: string) => held.get(key) ?? null,
          setItem: (key: string, value: string) => held.set(key, value),
        },
      },
      configurable: true,
    })
    try {
      const first = mount(() => <Overview />)
      first.click(first.button("Grid"))
      expect(held.get("estate.services.layout")).toBe("grid")
      const second = mount(() => <Overview />)
      expect(second.container.querySelector(".service-grid")).not.toBeNull()
    } finally {
      if (prior === undefined) Reflect.deleteProperty(globalThis, "window")
      else Object.defineProperty(globalThis, "window", prior)
    }
  })
})
