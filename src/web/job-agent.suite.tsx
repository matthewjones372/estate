/** @jsxImportSource solid-js */
/** Thin job and agent pages: run by `job-agent.test.ts` once Solid's compiler is in place. */
import { describe, expect, test } from "bun:test"
import { App } from "./App"
import { events, heard, now, operator } from "./fixture"
import { render } from "./harness"
import { AgentPage } from "./pages/Agent"
import { JobPage } from "./pages/Job"
import { recording } from "./recording"

const text = (html: string) =>
  html
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")

const withNamed = {
  ...events,
  catalog: {
    ...events.catalog,
    jobs: [{ name: "nightly-settlement", kind: "CronJob" as const, links: [], description: "Settles the day" }],
    agents: [
      {
        name: "support-triage",
        links: [],
        description: "Sorts customers' emails",
        budget: { tokens: 20_000_000, per: "day" as const },
        runs: true,
      },
    ],
  },
  services: {
    ...events.services,
    jobs: [
      {
        name: "nightly-settlement",
        health: "healthy" as const,
        reasons: [],
        job: {
          name: "nightly-settlement",
          kind: "CronJob" as const,
          schedule: "0 1 * * *",
          suspended: false,
          runs: [],
        },
      },
    ],
    agents: [
      {
        name: "support-triage",
        health: "attention" as const,
        reasons: ["over its budget"],
        usage: { model: "claude-sonnet", spent: 21_000_000 },
      },
    ],
  },
}

describe("a job or agent at its own address", () => {
  test("opens /jobs/nightly-settlement and /agents/support-triage and sees their titles", () => {
    expect(text(render(() => <JobPage name="nightly-settlement" />, { sent: withNamed }))).toContain(
      "nightly-settlement",
    )
    expect(text(render(() => <JobPage name="nightly-settlement" />, { sent: withNamed }))).toContain("0 1 * * *")
    expect(text(render(() => <AgentPage name="support-triage" />, { sent: withNamed }))).toContain("support-triage")
    expect(text(render(() => <AgentPage name="support-triage" />, { sent: withNamed }))).toContain("claude-sonnet")
  })

  test("unknown names show there is no such page", () => {
    expect(text(render(() => <JobPage name="missing-job" />, { sent: withNamed }))).toContain("There is no such page.")
    expect(text(render(() => <AgentPage name="missing-agent" />, { sent: withNamed }))).toContain(
      "There is no such page.",
    )
    const { actions } = recording()
    const estate = { live: heard(withNamed), me: operator, actions, now: () => now }
    expect(
      text(render(() => <App estate={{ ...estate, page: () => ({ page: "job" as const, name: "missing-job" }) }} />)),
    ).toContain("There is no such page.")
  })
})
