import { describe, expect, test } from "bun:test"
import type { AgentUsage } from "../../shared/agents"
import { tokens } from "../../shared/agents"
import type { Agent } from "../../shared/catalog"
import { catalog, environment, estate } from "../fixture"
import type { EnvironmentState, SourcedAlert } from "../state"
import { agentStateOf } from "./agents"
import { catalogView } from "./catalog"
import { feedView } from "./feed"
import { servicesView } from "./services"

const triage: Agent = {
  name: "support-triage",
  category: "Support",
  environments: ["production"],
  runtime: { kubernetes: { namespace: "support", workloads: [{ kind: "Deployment", name: "triage" }] } },
  budget: { tokens: 20_000_000, per: "day" },
  links: { traces: "https://langfuse.example/{env}/{agent}" },
}
const at = (now: number) => ({ now, points: [now] })
const using = (usage: AgentUsage, more: Partial<EnvironmentState> = {}) =>
  environment({
    metrics: {
      state: "ok",
      value: { services: {}, vitals: [], edges: [], charts: {}, agents: { "support-triage": usage } },
    },
    ...more,
  })
const pods = (...ready: ReadonlyArray<boolean>): Partial<EnvironmentState> => ({
  cluster: {
    state: "ok",
    value: {
      pods: {
        "support-triage": ready.map((each, index) => ({
          name: `p${index}`,
          phase: "Running",
          ready: each,
          restarts: 0,
        })),
      },
      debug: {},
    },
  },
})
const alert = (severity: string): SourcedAlert => ({
  id: severity,
  name: `Triage${severity}`,
  state: "firing",
  severity,
  startsAt: "",
  labels: { service: "support-triage" },
})

describe("an agent's health", () => {
  test("is healthy running within its budget, with its pods ready", () => {
    const state = agentStateOf(
      triage,
      using({ runs: at(10), errors: at(0.2), tokens: at(200_000), spent: 6_100_000 }, pods(true)),
    )
    expect(state).toMatchObject({ health: "healthy", reasons: [], pods: [{ name: "p0", ready: true }] })
  })

  test("needs someone failing too often, over its budget or on course for it, or with pods not ready", () => {
    const reasons = (usage: AgentUsage, more: Partial<EnvironmentState> = {}, agent = triage) =>
      agentStateOf(agent, using(usage, more)).reasons
    expect(reasons({ runs: at(10), errors: at(2) })).toEqual(["20% of runs failing"])
    expect(reasons({ runs: at(10), errors: at(2) }, {}, { ...triage, failing: 0.25 })).toEqual([])
    expect(reasons({ spent: 31_000_000 })).toEqual(["31M tokens this day, over its 20M"])
    expect(reasons({ tokens: at(1_000_000) })).toEqual(["on course for 24M tokens a day, over its 20M"])
    expect(reasons({}, pods(true, false))).toEqual(["1 of 2 pods not ready"])
    expect(agentStateOf(triage, using({}, pods(false))).health).toBe("critical")
  })

  test("is its alerts', worst first, and unknown before anything is read", () => {
    const alerted = using({}, { alerts: { state: "ok", value: [alert("warning"), alert("critical")] } })
    expect(agentStateOf(triage, alerted)).toMatchObject({
      health: "critical",
      reasons: ["Triagecritical is firing", "Triagewarning is firing"],
    })
    expect(agentStateOf(triage, environment())).toMatchObject({ health: "unknown", reasons: ["not read yet"] })
  })
})

describe("an agent on the page", () => {
  test("is in the catalog event with its budget and links, the services event, the worst, and the feed", () => {
    const withAgent = { ...catalog, agents: [triage] }
    expect(catalogView(withAgent, "production").agents).toEqual([
      {
        name: "support-triage",
        category: "Support",
        budget: { tokens: 20_000_000, per: "day" },
        links: [{ name: "traces", url: "https://langfuse.example/production/support-triage" }],
      },
    ])
    const changed = using({
      runs: at(10),
      errors: at(5),
      model: "claude-b",
      modelSince: "2026-10-03T11:00:00.000Z",
      modelWas: "claude-a",
    })
    const state = estate({ catalog: withAgent, environments: { production: changed } })
    const services = servicesView(state, "production")
    expect(services.agents?.[0]).toMatchObject({ name: "support-triage", health: "attention" })
    expect(services.environments.find((each) => each.name === "production")?.worst).toBe("attention")
    expect(feedView(state, "production", Date.parse("2026-10-03T12:00:00Z")).items).toContainEqual({
      at: "2026-10-03T11:00:00.000Z",
      kind: "deploy",
      service: "support-triage",
      text: "support-triage now uses claude-b, not claude-a",
    })
    expect(servicesView(estate(), "production").agents).toBeUndefined()
  })

  test("counts its tokens in millions and thousands", () => {
    expect([tokens(31_000_000), tokens(6_100_000), tokens(820_400), tokens(512)]).toEqual([
      "31M",
      "6.1M",
      "820k",
      "512",
    ])
  })
})
