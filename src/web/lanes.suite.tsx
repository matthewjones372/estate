/** @jsxImportSource solid-js */
/** The overview's lanes in happy-dom: grouped by category, and a job's: run by \`lanes.test.ts\` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { events } from "./fixture"
import { mount } from "./harness"
import { Overview } from "./pages/Overview"

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
