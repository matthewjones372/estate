import { describe, expect, test } from "bun:test"
import { catalog, environment, estate } from "../fixture"
import { nowView } from "./now"

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

describe("an environment's headline for agents", () => {
  test("says all quiet when nothing needs someone", () => {
    const state = estate({
      environments: {
        staging: environment({
          alerts: ok([]),
          cluster: ok({
            pods: { storefront: [{ name: "a", phase: "Running", ready: true, restarts: 0, image: "sf:v1" }] },
            debug: {},
          }),
        }),
        production: environment(),
      },
    })
    expect(nowView(state, "staging")).toMatchObject({
      tone: "healthy",
      top: "All quiet.",
      summary: expect.stringContaining("All quiet."),
    })
  })

  test("lists what needs someone, worst first, in the overview's words", () => {
    const state = estate({
      catalog,
      environments: {
        staging: environment(),
        production: environment({
          alerts: ok([
            {
              id: "a1",
              name: "OrdersSlow",
              state: "firing",
              severity: "warning",
              startsAt: "t",
              labels: { service: "orders" },
            },
          ]),
          cluster: ok({
            pods: {
              orders: [
                { name: "a", phase: "Running", ready: true, restarts: 0 },
                { name: "b", phase: "Running", ready: false, restarts: 0 },
              ],
            },
            debug: {},
          }),
        }),
      },
    })
    const now = nowView(state, "production")
    expect(now.kicker).toBe("Needs attention")
    expect(now.lede).toContain("orders:")
    expect(now.needs[0]?.name).toBe("orders")
    expect(now.summary).toMatch(/needs you/)
  })

  test("says not heard yet when every service is still unknown", () => {
    const state = estate({
      environments: { staging: environment(), production: environment() },
    })
    expect(nowView(state, "staging")).toMatchObject({
      top: "Not heard yet.",
      summary: expect.stringContaining("Not heard yet."),
    })
  })

  test("counts stores, jobs and agents among what needs someone", () => {
    const state = estate({
      catalog: {
        ...catalog,
        stores: [{ name: "orders-db", environments: ["staging"], engine: "postgres", selector: 'db="orders"' }],
        jobs: [
          {
            name: "vacuum",
            environments: ["staging"],
            run: { kubernetes: { namespace: "jobs", cronJob: "vacuum" } },
          },
        ],
        agents: [
          {
            name: "helper",
            environments: ["staging"],
            budget: { tokens: 1000, per: "day" },
          },
        ],
      },
      environments: {
        staging: environment({
          alerts: ok([
            {
              id: "s1",
              name: "DbFull",
              state: "firing",
              severity: "warning",
              startsAt: "t",
              labels: { store: "orders-db" },
            },
          ]),
          cluster: ok({
            pods: {},
            debug: {},
            jobs: {
              vacuum: [
                {
                  name: "vacuum",
                  kind: "CronJob",
                  suspended: false,
                  schedule: "0 * * * *",
                  runs: [
                    {
                      name: "vacuum-1",
                      outcome: "failed",
                      startedAt: "t",
                      finishedAt: "t",
                      message: "lock",
                    },
                  ],
                },
              ],
            },
          }),
          metrics: ok({
            services: {},
            stores: {},
            vitals: [],
            edges: [],
            charts: {},
            agents: { helper: { spent: 2000, model: "x" } },
          }),
        }),
        production: environment(),
      },
    })
    const now = nowView(state, "staging")
    expect(now.needs.map((each) => each.name).sort()).toEqual(["helper", "orders-db", "vacuum"])
    expect(new Set(now.needs.map((each) => each.kind))).toEqual(new Set(["store", "job", "agent"]))
  })
})
