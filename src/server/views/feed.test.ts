import { describe, expect, test } from "bun:test"
import { shortVersion } from "../../shared/feed"
import type { Incident } from "../../shared/incidents"
import { catalog, environment, estate } from "../fixture"
import type { SourcedAlert } from "../state"
import { feedView } from "./feed"

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })
const slow: SourcedAlert = {
  id: "Slow-1",
  name: "Slow",
  state: "silenced",
  severity: "warning",
  startsAt: "2026-10-03T11:00:00Z",
  labels: { app: "orders" },
  silence: { id: "s", by: "gil", reason: "vacuum", startsAt: "2026-10-03T11:30:00Z", endsAt: "2026-10-03T13:00:00Z" },
}
const note = (id: string, at: string, alert: string, environment = "staging") => ({
  id,
  at,
  by: "gil",
  text: id,
  environment,
  alert,
})
const incident = (id: string, title: string, environment: string, notes: NonNullable<Incident["notes"]>): Incident => ({
  id,
  title,
  openedBy: "gil",
  openedAt: "2026-10-03T10:00:00Z",
  firings: [
    { environment, alert: "Slow-1", startsAt: slow.startsAt, linkedBy: "gil", linkedAt: "2026-10-03T10:00:00Z" },
  ],
  notes,
})

const state = estate({
  catalog: {
    ...catalog,
    jobs: [{ name: "settle", environments: ["staging"], run: { kubernetes: { namespace: "batch", cronJob: "s" } } }],
    agents: [{ name: "triage", environments: ["staging"] }],
  },
  environments: {
    staging: environment({
      alerts: ok([slow]),
      resolved: [
        {
          alert: "Gone-1",
          name: "Gone",
          labels: {},
          startsAt: "2026-10-03T09:00:00Z",
          endsAt: "2026-10-03T09:10:00Z",
        },
      ],
      metrics: ok({
        services: {},
        agents: { triage: { model: "claude-haiku-4-5", modelSince: "2026-10-03T08:00:00Z" } },
        vitals: [],
        edges: [],
        charts: {},
      }),
      cluster: ok({
        pods: {},
        debug: { storefront: { level: "DEBUG", on: true, since: "2026-10-03T11:50:00Z", by: "ada" } },
        jobs: {
          settle: [{ name: "s", kind: "CronJob", suspended: false, runs: [run("2026-10-03T07:00:00Z")] }],
          orders: [{ name: "reindex", kind: "Job", suspended: false, runs: [run("2026-10-03T06:00:00Z")] }],
        },
      }),
      deploys: ok({ orders: { version: "v3", ready: true, at: "2026-10-03T10:30:00Z" } }),
    }),
    production: environment(),
  },
  builds: ok({
    orders: [
      { sha: "a", title: "Faster", status: "success", at: "2026-10-03T05:00:00Z", url: "https://ci/1" },
      { sha: "b", title: "Slower", status: "failure", at: "2026-10-03T04:00:00Z", url: "" },
    ],
  }),
  firings: [
    {
      environment: "staging",
      alert: "Old-1",
      name: "Old",
      startsAt: "2026-10-03T03:00:00Z",
      endsAt: "2026-10-03T03:30:00Z",
    },
  ],
  notes: [
    note("on the live one", "2026-10-03T11:40:00Z", "Slow-1"),
    note("on a past one", "2026-10-03T03:10:00Z", "Old-1"),
    note("on one not kept", "2026-10-03T02:00:00Z", "Lost-1"),
  ],
  incidents: [
    incident("i1", "Chip registry slow", "staging", [
      { id: "n1", at: "2026-10-03T11:55:00Z", by: "ada", text: "registry restarted" },
    ]),
    incident("i2", "Elsewhere", "production", [{ id: "n2", at: "2026-10-03T11:56:00Z", by: "ada", text: "not here" }]),
  ],
})

function run(finishedAt: string) {
  return { name: "r", outcome: "succeeded" as const, startedAt: finishedAt, finishedAt }
}

describe("the feed", () => {
  test("says what each change is about, so each opens its page", () => {
    const items = feedView(state, "staging", Date.parse("2026-10-03T12:00:00Z")).items
    const about = items.map(({ at: _, text, ...rest }) => [text, rest])
    expect(about).toEqual([
      ["registry restarted", { kind: "note", who: "ada", incident: { id: "i1", title: "Chip registry slow" } }],
      ["debug on until switched off", { kind: "debug", service: "storefront", who: "ada" }],
      ["on the live one", { kind: "note", who: "gil", on: "Slow", alert: "Slow-1" }],
      [
        "silenced Slow until 2026-10-03T13:00:00Z: vacuum",
        { kind: "silence", service: "orders", who: "gil", alert: "Slow-1" },
      ],
      ["Slow fired", { kind: "alert", service: "orders", alert: "Slow-1" }],
      ["v3 applied", { kind: "deploy", service: "orders", version: "v3" }],
      ["Gone resolved", { kind: "resolved", firing: { alert: "Gone-1", startsAt: "2026-10-03T09:00:00Z" } }],
      ["triage now uses claude-haiku-4-5", { kind: "deploy", service: "triage", agent: "triage" }],
      ["job s succeeded", { kind: "job", service: "settle", job: "settle" }],
      ["job reindex succeeded", { kind: "job", service: "orders" }],
      [
        "build passed: Faster",
        { kind: "build", service: "orders", url: "https://ci/1", build: { title: "Faster", passed: true } },
      ],
      ["build failed: Slower", { kind: "build", service: "orders", build: { title: "Slower", passed: false } }],
      [
        "on a past one",
        { kind: "note", who: "gil", on: "Old", firing: { alert: "Old-1", startsAt: "2026-10-03T03:00:00Z" } },
      ],
      ["on one not kept", { kind: "note", who: "gil", alert: "Lost-1" }],
    ])
  })

  test("says a version that is a digest by its first 12 characters, and keeps all of it", () => {
    expect(shortVersion("743fb49a20393a43ea2b57a628414504a1e8baf536ef836d0981dec3c0839701")).toBe("743fb49a2039")
    expect(shortVersion("sha256:743fb49a20393a43ea2b57a628414504a1e8baf536ef836d0981dec3c0839701")).toBe("743fb49a2039")
    expect(shortVersion("main-154-199fdaf")).toBe("main-154-199fdaf")
  })
})
