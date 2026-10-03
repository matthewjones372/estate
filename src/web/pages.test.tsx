import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { App } from "./App"
import { events, heard, now, operator, recording, render } from "./fixture"
import { Alerts, alertsSummary } from "./pages/Alerts"
import { Deploys, summaryOf } from "./pages/Deploys"
import { headlineOf, Overview, tilesOf } from "./pages/Overview"
import { ServicePage } from "./pages/Service"
import { NoAccess, Reading, SignIn } from "./pages/States"
import { pipelineOf } from "./parts/Rail"

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("the overview", () => {
  test("says how many things need someone, and what", () => {
    expect(headlineOf(events)).toMatchObject({
      tone: "attention",
      top: "One thing",
      bottom: "needs you.",
      lede: "storefront: OrdersSlow is firing.",
    })
  })

  test("says all quiet only when a source has said so", () => {
    expect(headlineOf({})).toMatchObject({ top: "All quiet.", lede: "No service is in this environment yet." })
    const unknown = {
      services: {
        ...events.services,
        services: events.services.services.map((each) => ({ ...each, health: "unknown" as const, reasons: [] })),
      },
    }
    expect(headlineOf(unknown).top).toBe("Not heard yet.")
    const quiet = {
      services: {
        ...events.services,
        services: events.services.services.map((each) => ({ ...each, health: "healthy" as const, reasons: [] })),
      },
    }
    expect(headlineOf(quiet)).toMatchObject({ top: "All quiet.", lede: "Two services healthy, nothing firing." })
  })

  test("calls a critical alert down", () => {
    const critical = {
      alerts: {
        ...events.alerts,
        alerts: [
          {
            ...events.alerts.alerts[0],
            severity: "critical",
            state: "firing",
          } as (typeof events.alerts.alerts)[number],
        ],
      },
    }
    expect(headlineOf(critical).tone).toBe("critical")
  })

  test("fills four tiles: the catalog's vitals, then what Estate always knows", () => {
    expect(tilesOf(events).map((tile) => `${tile.label}: ${tile.value}`)).toEqual([
      "Orders: 5/s",
      "Services healthy: 1 of 2",
      "Alerts firing: 1",
      "Pods ready: 1/1",
    ])
  })

  test("draws the headline, the map, the card for what fires, silences, lanes and the feed", () => {
    const page = text(render(<Overview />))
    for (const words of [
      "One thing needs you.",
      "The estate, live",
      "Orders are slow",
      "On it.",
      "silenced until",
      "resizing",
      "storefront",
      "Degraded",
      "Debug until",
      "What changed today",
      "Prometheus did not answer",
      "Not set up here: GitHub (builds)",
      "Postgres",
      "12/s",
    ]) {
      expect(page).toContain(words)
    }
  })

  test("shows the sources as they answer on the first load", () => {
    const page = text(renderToStaticMarkup(<Reading sources={events.services.sources} />))
    expect(page).toContain("Kubernetes read")
    expect(page).toContain("Prometheus did not answer")
    expect(page).not.toContain("GitHub")
    expect(text(renderToStaticMarkup(<Reading sources={undefined} />))).toContain("Connecting to Estate")
  })
})

describe("the pipeline rail", () => {
  test("names the step that is stuck, building, rolling out or running", () => {
    const [storefront, orders] = events.deploys.services
    expect(pipelineOf(storefront?.builds ?? [], storefront?.environments[1], now)).toMatchObject({
      steps: ["done", "done", "done", "done"],
      note: "running, 40 min",
      sha: "c556728",
    })
    expect(pipelineOf(orders?.builds ?? [], orders?.environments[0], now)).toMatchObject({
      steps: ["done", "active", "stalled", "active"],
      note: "stalled: cannot scan the registry",
      tone: "attention",
    })
    expect(pipelineOf(orders?.builds ?? [], undefined, now)).toMatchObject({ note: "building, 4 min", tone: "active" })
    expect(
      pipelineOf([{ sha: "a", title: "t", status: "failure", at: "2026-10-03T11:00:00Z", url: "u" }], undefined, now),
    ).toMatchObject({ note: "build failed" })
    expect(
      pipelineOf([], { environment: "x", running: "v1", chosen: { version: "v2", ready: false } }, now),
    ).toMatchObject({ note: "rolling out" })
    expect(pipelineOf([], undefined, now)).toMatchObject({
      steps: ["waiting", "waiting", "waiting", "waiting"],
      note: "not running",
    })
  })
})

describe("the other pages", () => {
  test("deploys says what is stuck, and puts environments side by side", () => {
    expect(summaryOf(events.deploys)).toEqual({
      title: "One deploy is stuck.",
      detail: "orders stalled: cannot scan the registry. orders is building.",
    })
    expect(summaryOf(undefined).title).toBe("Every deploy is in step.")
    const page = text(render(<Deploys />))
    for (const words of [
      "Across environments",
      "Pipelines · production",
      "v7 cannot scan the registry",
      "not here",
      "Faster pages",
    ])
      expect(page).toContain(words)
  })

  test("alerts lists them all with their latest note, and what resolved", () => {
    expect(alertsSummary(events.alerts.alerts)).toBe("One alert firing, 1 pending, 1 silenced.")
    expect(alertsSummary([])).toBe("Nothing is firing, pending or silenced.")
    const page = text(render(<Alerts />))
    for (const words of ["Orders are slow", "On it.", "QueueGrowing", "Unsilence", "resolved at", "after 8 min"])
      expect(page).toContain(words)
  })

  test("a service shows its load, pods, alerts today, debug and builds", () => {
    const page = text(render(<ServicePage name="storefront" />))
    for (const words of [
      "The shop&#x27;s pages",
      "Owner web",
      "running v2",
      "storefront-1",
      "up 2 h",
      "OrdersSlow",
      "On until",
      "Turn off now",
      "Faster pages",
      "threshold 200 ms",
    ]) {
      expect(page).toContain(words)
    }
    expect(text(render(<ServicePage name="orders" />))).toContain("The catalog names no log level for orders")
    expect(text(render(<ServicePage name="nothing" />))).toContain("nothing is not in production")
  })

  test("a viewer sees debug and silences but cannot switch them", () => {
    const viewer = { ...operator, role: "viewer" as const }
    const page = text(render(<ServicePage name="storefront" />, { me: viewer }))
    expect(page).not.toContain("Turn off now")
    expect(text(render(<Overview />, { me: viewer }))).not.toContain("Silence…")
  })

  test("the app draws the header and the page the address names", () => {
    const { actions } = recording()
    const estate = { live: heard(), me: operator, actions, now: () => now }
    expect(text(renderToStaticMarkup(<App estate={{ ...estate, page: { page: "alerts" } }} />))).toContain(
      "ada lovelace · operator",
    )
    expect(text(renderToStaticMarkup(<App estate={{ ...estate, page: { page: "missing" } }} />))).toContain(
      "There is no such page.",
    )
    expect(text(renderToStaticMarkup(<App estate={{ ...estate, page: { page: "deploys" } }} />))).toContain(
      "Across environments",
    )
    expect(
      text(renderToStaticMarkup(<App estate={{ ...estate, page: { page: "service", name: "orders" } }} />)),
    ).toContain("Pods")
  })

  test("signing in and having no role are pages of their own", () => {
    expect(renderToStaticMarkup(<SignIn returnTo="/alerts?env=x" />)).toContain(
      "/auth/login?returnTo=%2Falerts%3Fenv%3Dx",
    )
    expect(text(renderToStaticMarkup(<NoAccess name="eve" groups={["ops", "admins"]} />))).toContain(
      "It is open to ops, admins.",
    )
    expect(text(renderToStaticMarkup(<NoAccess name="eve" groups={[]} />))).toContain("nobody yet")
  })
})
