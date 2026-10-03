import { describe, expect, test } from "bun:test"
import type { Pod } from "../../shared/events"
import { catalog, environment, estate, storefront } from "../fixture"
import type { SourcedAlert } from "../state"
import { alertsView } from "./alerts"
import { catalogView } from "./catalog"
import { deploysView } from "./deploys"
import { feedView } from "./feed"
import { healthOf, serviceOf, worst } from "./health"
import { servicesView, versionOf } from "./services"

const services = catalog.services
const pod = (name: string, ready: boolean, image = "registry/storefront:main-412-c556728"): Pod => ({
  name,
  phase: "Running",
  ready,
  restarts: 0,
  image,
})
const alert = (name: string, labels: Record<string, string>, extra: Partial<SourcedAlert> = {}): SourcedAlert => ({
  id: `${name}-1`,
  name,
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-03T11:00:00Z",
  labels,
  ...extra,
})
const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

describe("which service an alert is about", () => {
  test("is named by one of its labels, or is the only service in its namespace", () => {
    expect(serviceOf({ service: "orders" }, services)).toBe("orders")
    expect(serviceOf({ app: "storefront" }, services)).toBe("storefront")
    expect(serviceOf({ namespace: "shop" }, services)).toBe("storefront")
    expect(serviceOf({ namespace: "elsewhere" }, services)).toBeUndefined()
    expect(serviceOf({ job: "node-exporter" }, services)).toBeUndefined()
  })
})

describe("a service's health", () => {
  test("is unknown until a source answers", () => {
    expect(healthOf(storefront, environment(), services)).toEqual({
      health: "unknown",
      reasons: ["no source has answered"],
    })
  })

  test("is healthy when its pods are ready and nothing fires", () => {
    const state = environment({ cluster: ok({ pods: { storefront: [pod("a", true)] }, debug: {} }) })
    expect(healthOf(storefront, state, services).health).toBe("healthy")
  })

  test("needs attention for a warning, a pod not ready, or a stalled deploy", () => {
    const state = environment({
      alerts: ok([alert("Slow", { app: "storefront" })]),
      cluster: ok({ pods: { storefront: [pod("a", true), pod("b", false)] }, debug: {} }),
      deploys: ok({ storefront: { version: "v2", ready: false, stalled: "cannot pull" } }),
    })
    expect(healthOf(storefront, state, services)).toEqual({
      health: "attention",
      reasons: ["Slow is firing", "1 of 2 pods not ready", "deploy stalled: cannot pull"],
    })
  })

  test("is down for a critical alert, or when no pod is ready", () => {
    const critical = environment({ alerts: ok([alert("Down", { app: "storefront" }, { severity: "critical" })]) })
    expect(healthOf(storefront, critical, services).health).toBe("critical")
    const noPods = environment({ cluster: ok({ pods: { storefront: [pod("a", false)] }, debug: {} }) })
    expect(healthOf(storefront, noPods, services)).toEqual({ health: "critical", reasons: ["no pod is ready"] })
  })

  test("silenced and pending alerts do not count", () => {
    const state = environment({
      alerts: ok([
        alert("Slow", { app: "storefront" }, { state: "pending" }),
        alert("Quiet", { app: "storefront" }, { state: "silenced" }),
      ]),
    })
    expect(healthOf(storefront, state, services).health).toBe("healthy")
  })

  test("an environment's worst is its worst service", () => {
    expect(worst(["healthy", "unknown", "attention"])).toBe("attention")
    expect(worst([])).toBe("healthy")
  })
})

describe("the services event", () => {
  test("names each source's state, each environment's worst, and each service's version and debug", () => {
    const state = estate({
      environments: {
        staging: environment({
          cluster: ok({
            pods: { storefront: [pod("a", true)] },
            debug: { storefront: { level: "DEBUG", on: true, by: "ada" } },
          }),
          alerts: ok([alert("PaymentsSlow", { app: "orders" })]),
        }),
        production: environment(),
      },
    })
    const view = servicesView(state, "staging")
    expect(view.sources.map((source) => `${source.kind}:${source.state}`)).toEqual([
      "alerts:ok",
      "cluster:ok",
      "deploys:off",
      "metrics:off",
      "builds:off",
    ])
    expect(view.environments).toEqual([
      { name: "staging", worst: "attention" },
      { name: "production", worst: "unknown" },
    ])
    expect(view.services[0]).toMatchObject({
      name: "storefront",
      version: "main-412-c556728",
      debug: { on: true, by: "ada" },
    })
    expect(view.edges.map((edge) => edge.alerting)).toEqual([false, true, false])
    expect(servicesView(state, "qa").services).toEqual([])
  })

  test("reads a version from an image's tag, or its digest", () => {
    expect(versionOf("registry:5000/shop/orders:v1.2")).toBe("v1.2")
    expect(versionOf("registry:5000/shop/orders@sha256:0123456789abcdef")).toBe("0123456789ab")
    expect(versionOf("orders")).toBe("latest")
    expect(versionOf(undefined)).toBeUndefined()
  })
})

describe("the catalog event", () => {
  test("fills each link in for the environment, and draws only what is in it", () => {
    const view = catalogView(catalog, "staging")
    expect(view.services[0]?.links).toEqual([{ name: "logs", url: "https://logs.example/staging/shop/storefront" }])
    expect(view.map.nodes.map((node) => node.id)).toEqual(["storefront", "orders", "db"])
    expect(view.map.edges.map((edge) => edge.to)).toEqual(["orders", "db"])
  })
})

describe("the alerts event", () => {
  test("puts firing first, critical before warning, with notes newest first and the runbook from the catalog", () => {
    const state = estate({
      environments: {
        staging: environment({
          alerts: ok([
            alert("Pending", { app: "orders" }, { state: "pending" }),
            alert("Warn", { app: "orders" }),
            alert("Crit", { app: "storefront" }, { severity: "critical" }),
          ]),
          resolved: [
            {
              name: "Old",
              labels: { app: "orders" },
              startsAt: "2026-10-03T08:00:00Z",
              endsAt: "2026-10-03T09:00:00Z",
            },
            { name: "Later", labels: {}, startsAt: "2026-10-03T09:30:00Z", endsAt: "2026-10-03T10:00:00Z" },
          ],
        }),
        production: environment(),
      },
      notes: [
        { id: "1", at: "2026-10-03T11:01:00Z", by: "ada", text: "first", environment: "staging", alert: "Crit-1" },
        { id: "2", at: "2026-10-03T11:02:00Z", by: "gil", text: "second", environment: "staging", alert: "Crit-1" },
        {
          id: "3",
          at: "2026-10-03T11:03:00Z",
          by: "gil",
          text: "elsewhere",
          environment: "production",
          alert: "Crit-1",
        },
      ],
    })
    const view = alertsView(state, "staging", true)
    expect(view.alerts.map((each) => each.name)).toEqual(["Crit", "Warn", "Pending"])
    expect(view.alerts[0]?.notes.map((note) => note.text)).toEqual(["second", "first"])
    expect(view.alerts[0]?.runbook).toBe("https://runbooks.example/storefront")
    expect(view.resolved).toEqual([
      { name: "Later", startsAt: "2026-10-03T09:30:00Z", endsAt: "2026-10-03T10:00:00Z" },
      { name: "Old", service: "orders", startsAt: "2026-10-03T08:00:00Z", endsAt: "2026-10-03T09:00:00Z" },
    ])
    expect(alertsView(state, "qa", false)).toEqual({ alerts: [], resolved: [], silences: false })
  })
})

describe("the deploys event", () => {
  test("puts each service's environments side by side", () => {
    const state = estate({
      environments: {
        staging: environment({
          cluster: ok({ pods: { storefront: [pod("a", true, "r/storefront:v2")] }, debug: {} }),
          deploys: ok({ storefront: { version: "v2", ready: true } }),
        }),
        production: environment({ deploys: ok({ storefront: { version: "v1", ready: false, stalled: "no image" } }) }),
      },
    })
    const view = deploysView(state)
    expect(view.environments).toEqual(["staging", "production"])
    expect(view.services[0]?.environments).toEqual([
      { environment: "staging", running: "v2", chosen: { version: "v2", ready: true } },
      { environment: "production", chosen: { version: "v1", ready: false }, stalled: "no image" },
    ])
    expect(
      view.services.find((service) => service.name === "payments")?.environments.map((each) => each.environment),
    ).toEqual(["production"])
  })
})

describe("the feed", () => {
  test("is the last day's changes from every source and record, newest first", () => {
    const state = estate({
      environments: {
        staging: environment({
          alerts: ok([
            alert(
              "Slow",
              { app: "orders" },
              {
                silence: {
                  id: "s",
                  by: "gil",
                  reason: "vacuum",
                  startsAt: "2026-10-03T11:30:00Z",
                  endsAt: "2026-10-03T13:00:00Z",
                },
              },
            ),
            alert("Ancient", { app: "orders" }, { startsAt: "2026-09-01T00:00:00Z" }),
          ]),
          resolved: [{ name: "Gone", labels: {}, startsAt: "2026-10-03T09:00:00Z", endsAt: "2026-10-03T09:10:00Z" }],
          cluster: ok({
            pods: {},
            debug: {
              storefront: {
                level: "DEBUG",
                on: true,
                since: "2026-10-03T11:50:00Z",
                until: "2026-10-03T12:05:00Z",
                by: "ada",
              },
            },
          }),
          deploys: ok({ orders: { version: "v3", ready: true, at: "2026-10-03T10:00:00Z" } }),
        }),
        production: environment(),
      },
      builds: ok({
        orders: [
          { sha: "abc", title: "Faster baskets", status: "success", at: "2026-10-03T09:30:00Z", url: "u" },
          { sha: "def", title: "Wip", status: "running", at: "2026-10-03T11:59:00Z", url: "u" },
        ],
      }),
      notes: [
        { id: "1", at: "2026-10-03T11:40:00Z", by: "gil", text: "on it", environment: "staging", alert: "Slow-1" },
      ],
    })
    const items = feedView(state, "staging", Date.parse("2026-10-03T12:00:00Z")).items
    expect(items.map((item) => `${item.kind}: ${item.text}`)).toEqual([
      "debug: debug on until 2026-10-03T12:05:00Z",
      "note: on it",
      "silence: silenced Slow until 2026-10-03T13:00:00Z: vacuum",
      "alert: Slow fired",
      "deploy: v3 applied",
      "build: build passed: Faster baskets",
      "resolved: Gone resolved",
    ])
    expect(feedView(state, "qa", 0)).toEqual({ items: [] })
  })
})
