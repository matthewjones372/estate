import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { checkCatalog } from "./check"

const mistakes = (input: unknown) => {
  const checked = checkCatalog(input)
  return Result.isFailure(checked) ? checked.failure : []
}

describe("jobs no service owns", () => {
  const environments = [{ name: "a", sources: "a" }]
  const job = (name: string, run: unknown, more: object = {}) => ({ name, environments: ["a"], run, ...more })

  test("each name a CronJob or a Job in a namespace, or an ECS scheduled task, under a name of their own", () => {
    expect(
      mistakes({
        environments,
        services: [{ name: "s", environments: ["a"] }],
        jobs: [
          job(
            "settle",
            { kubernetes: { namespace: "batch", cronJob: "nightly-settle" } },
            { links: { logs: "https://logs/{env}/{job}" } },
          ),
          job("report", { ecs: { cluster: "shop", scheduledTask: "report" } }),
        ],
      }),
    ).toEqual([])
    expect(
      mistakes({
        environments,
        services: [{ name: "s", environments: ["a"] }],
        jobs: [
          job("s", { kubernetes: { namespace: "batch", cronJob: "c", job: "j" } }, { environments: ["b"] }),
          job("x", { kubernetes: { namespace: "batch" } }),
          job("x", { kubernetes: { namespace: "batch" } }, { links: { logs: "https://logs/{service}" } }),
        ],
      }).map((mistake) => `${mistake.at}: ${mistake.message}`),
    ).toEqual([
      'jobs: "x" is named twice',
      "jobs[0] (s): \"s\" is also a service's or store's name",
      'jobs[0] (s).environments: "b" is not an environment',
      "jobs[0] (s).run.kubernetes: names a cronJob or a job, not both",
      "jobs[2] (x).links.logs: {service} is not one of {env}, {job}, {namespace}, nor a value a names",
    ])
  })
})

describe("teams", () => {
  test("are named once, own what names them, and take {team} and {env} in their links", () => {
    const environments = [{ name: "a", sources: "a" }]
    expect(
      mistakes({
        environments,
        teams: [{ name: "web", links: { slack: "https://slack/{team}-{env}" } }],
        services: [{ name: "s", environments: ["a"], owner: "web" }],
      }),
    ).toEqual([])
    expect(
      mistakes({
        environments,
        teams: [{ name: "web" }, { name: "web", links: { wiki: "https://wiki/{service}" } }],
        services: [{ name: "s", environments: ["a"], owner: "data" }],
        jobs: [{ name: "j", environments: ["a"], owner: "ops", run: { kubernetes: { namespace: "n" } } }],
      }).map((mistake) => `${mistake.at}: ${mistake.message}`),
    ).toEqual([
      'teams: "web" is named twice',
      'services[0] (s).owner: "data" is not one of the teams',
      'jobs[0] (j).owner: "ops" is not one of the teams',
      "teams[1] (web).links.wiki: {service} is not one of {env}, {team}, nor a value a names",
    ])
  })
})

describe("agents", () => {
  test("are named once, query in good shape, need what they spent to be held to a budget, and fail by a share", () => {
    const environments = [{ name: "a", sources: "a" }]
    const agent = (name: string, more: object = {}) => ({ name, environments: ["a"], ...more })
    expect(
      mistakes({
        environments,
        services: [{ name: "s", environments: ["a"] }],
        agents: [
          agent("triage", {
            usage: { spent: "sum(x)" },
            budget: { tokens: 1000, per: "day" },
            links: { t: "https://t/{agent}" },
          }),
        ],
      }),
    ).toEqual([])
    expect(
      mistakes({
        environments,
        services: [{ name: "s", environments: ["a"] }],
        agents: [
          agent("s", { environments: ["b"], usage: { runs: "sum(x" }, budget: { tokens: 1, per: "day" }, failing: 2 }),
          agent("t", { owner: "ops" }),
          agent("t"),
        ],
        teams: [{ name: "support" }],
      }).map((mistake) => `${mistake.at}: ${mistake.message}`),
    ).toEqual([
      'agents: "t" is named twice',
      "agents[0] (s): \"s\" is also a service's or store's name",
      'agents[0] (s).environments: "b" is not an environment',
      "agents[0] (s).usage.runs: the query is missing a )",
      "agents[0] (s).budget: needs usage.spent, the tokens spent over its period, to be held to",
      "agents[0] (s).failing: is a share of runs, above 0 and at most 1",
      'agents[1] (t).owner: "ops" is not one of the teams',
    ])
  })
})
