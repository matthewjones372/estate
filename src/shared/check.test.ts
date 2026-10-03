import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { checkCatalog, queryMistake } from "./check"

const catalog = {
  environments: [
    { name: "staging", sources: "staging" },
    { name: "production", title: "Production", sources: "production" },
  ],
  services: [
    {
      name: "orders",
      environments: ["staging", "production"],
      repository: "github:example/orders",
      load: { requests: 'sum(rate(http_requests_total{app="orders"}[1m]))' },
      links: { logs: "https://logs.example/{env}/{namespace}/{service}" },
      debug: { configMap: "orders-logging", key: "level", levels: ["INFO", "DEBUG"] },
    },
    { name: "payments", environments: ["production"] },
  ],
  vitals: [{ title: "Orders", query: "sum(rate(orders_total[1m]))", unit: "/s" }],
  map: {
    nodes: [
      { id: "orders", service: "orders" },
      { id: "payments", service: "payments" },
      { id: "db", kind: "store" },
    ],
    edges: [{ from: "orders", to: "payments", rate: "sum(rate(payment_calls_total[1m]))" }],
  },
}

const mistakes = (input: unknown) => {
  const checked = checkCatalog(input)
  return Result.isFailure(checked) ? checked.failure : []
}

describe("the catalog's check", () => {
  test("accepts a catalog with nothing wrong", () => {
    const checked = checkCatalog(catalog)
    expect(Result.isSuccess(checked)).toBe(true)
  })

  test("names every mistake in the shape, with where it is", () => {
    const broken = {
      environments: [{ name: 1, sources: "staging" }],
      services: [{ name: "orders", environments: "staging" }],
      colour: "blue",
    }
    expect(mistakes(broken)).toEqual([
      { at: "colour", message: "Expected no excess property" },
      { at: "environments[0].name", message: "Expected string" },
      { at: "services[0].environments", message: "Expected array" },
    ])
  })

  test("names every mistake a schema cannot see", () => {
    const broken = {
      environments: [...catalog.environments, { name: "staging", sources: "x" }],
      services: [
        {
          name: "orders",
          environments: ["staging", "qa"],
          repository: "gitlab.com/example/orders",
          load: { requests: "sum(rate(x[1m])", errors: 'rate(x{a="b}[1m])', p99: " " },
          links: { logs: "https://logs.example/{cluster}/{service}" },
          debug: { configMap: "orders-logging", key: "level", levels: ["DEBUG"] },
          logs: { errors: "ERROR|(", mask: ["\\d{16}", "[card"] },
        },
        { name: "orders", environments: [] },
      ],
      vitals: [{ title: "Orders", query: "sum(rate(orders_total[1m])))" }],
      stores: [
        {
          name: "orders-db",
          environments: ["qa"],
          engine: "postgres",
          selector: " ",
          extra: [{ title: "Outbox", query: "max(outbox_lag" }],
          attention: { connections: 90, memory: 95 },
        },
        {
          name: "orders-db",
          environments: ["staging"],
          engine: "redis",
          selector: 'instance="cache"',
          links: { dashboard: "https://grafana.example/{env}/{store}/{namespace}" },
        },
        { name: "orders", environments: [], engine: "kafka", selector: 'job="kafka"' },
      ],
      map: {
        nodes: [{ id: "a", service: "carts" }, { id: "a" }, { id: "db", store: "nothing", service: "orders" }],
        edges: [{ from: "a", to: "b", rate: "sum(x" }],
      },
    }
    expect(mistakes(broken).map((mistake) => `${mistake.at}: ${mistake.message}`)).toEqual([
      'environments: "staging" is named twice',
      'services: "orders" is named twice',
      'services[0] (orders).environments: "qa" is not an environment',
      "services[0] (orders).load.requests: the query is missing a )",
      'services[0] (orders).load.errors: the query has an unclosed "',
      "services[0] (orders).load.p99: the query is empty",
      "services[0] (orders).links.logs: {cluster} is not one of {env}, {namespace}, {service}, nor a value staging names",
      "services[0] (orders).debug.levels: needs the usual level and the debug level, in that order",
      'services[0] (orders).repository: "gitlab.com/example/orders" is not github:owner/name',
      'services[0] (orders).logs.errors: "ERROR|(" is not a pattern',
      'services[0] (orders).logs.mask[1]: "[card" is not a pattern',
      "vitals[0] (Orders): the query has an unmatched )",
      'stores: "orders-db" is named twice',
      'stores[0] (orders-db).environments: "qa" is not an environment',
      "stores[0] (orders-db).selector: is empty",
      "stores[0] (orders-db).extra[0] (Outbox): the query is missing a )",
      "stores[0] (orders-db).attention.memory: is not one of postgres's: connections, lag",
      "stores[1] (orders-db).links.dashboard: {namespace} is not one of {env}, {store}, nor a value staging names",
      'stores[2] (orders): "orders" is also a service\'s name',
      'map.nodes: "a" is named twice',
      'map.nodes[0] (a): "carts" is not a service',
      'map.nodes[2] (db): "nothing" is not a store',
      "map.nodes[2] (db): names a service and a store; a node is one or the other",
      'map.edges[0] (a → b): "b" is not a node',
      "map.edges[0] (a → b): the query is missing a )",
    ])
  })

  test("refuses a catalog with no environment", () => {
    expect(mistakes({ environments: [], services: [] })).toEqual([
      { at: "environments", message: "names no environment" },
    ])
  })

  test("reads brackets inside quotes as text", () => {
    expect(queryMistake('count(up{job="a)b"})')).toBeUndefined()
    expect(queryMistake("sum(x]")).toBe("has an unmatched ]")
  })
})

describe("a service's jobs", () => {
  test("need the namespace they run in", () => {
    expect(
      mistakes({
        environments: [{ name: "a", sources: "a" }],
        services: [{ name: "s", environments: ["a"], jobs: [{ kind: "CronJob", name: "backup" }] }],
      }),
    ).toEqual([
      {
        at: "services[0] (s).jobs",
        message: "needs a runtime, Kubernetes' namespace or ECS's cluster, where its jobs run",
      },
    ])
  })
})

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

describe("a link's values", () => {
  test("may be named when every environment the service runs in has them", () => {
    const valued = {
      environments: [
        { name: "home", sources: "home", values: { grafana: "https://grafana.example" } },
        { name: "kind", sources: "kind", values: { grafana: "http://localhost:3000" } },
      ],
      services: [{ name: "s", environments: ["home", "kind"], links: { dashboard: "{grafana}/d/{service}" } }],
    }
    expect(mistakes(valued)).toEqual([])
    const lacking = { ...valued, environments: [valued.environments[0], { name: "kind", sources: "kind" }] }
    expect(mistakes(lacking)).toEqual([
      {
        at: "services[0] (s).links.dashboard",
        message: "{grafana} is not one of {env}, {namespace}, {service}, nor a value kind names",
      },
    ])
  })
})

describe("a service's deploy tool", () => {
  test("is Flux, Argo CD or Harness, one of them", () => {
    const environments = [{ name: "a", sources: "a" }]
    const deployed = (deploy: unknown) =>
      mistakes({ environments, services: [{ name: "s", environments: ["a"], deploy }] })
    expect(deployed({ argo: { application: "shop-s" } })).toEqual([])
    expect(deployed({ harness: { org: "o", project: "p", pipeline: "cd" } })).toEqual([])
    expect(deployed({})).toEqual([
      { at: "services[0] (s).deploy", message: "names one deploy tool: flux, argo or harness" },
    ])
    expect(deployed({ argo: { application: "a" }, flux: { kustomization: "k" } })).toHaveLength(1)
  })
})

describe("a service's runtime and builds", () => {
  test("may be named by kind, as runtime.kubernetes and build.github, but Kubernetes not both ways", () => {
    const kubernetes = { namespace: "shop", workloads: [{ kind: "Deployment", name: "orders" }] }
    const environments = [{ name: "a", sources: "a" }]
    expect(
      mistakes({
        environments,
        services: [
          {
            name: "orders",
            environments: ["a"],
            runtime: { kubernetes },
            build: { github: { workflow: "build.yml" } },
          },
        ],
      }),
    ).toEqual([])
    expect(
      mistakes({
        environments,
        services: [{ name: "orders", environments: ["a"], kubernetes, runtime: { kubernetes } }],
      }),
    ).toEqual([
      {
        at: "services[0] (orders)",
        message: "names Kubernetes twice, as kubernetes and as runtime.kubernetes; keep one",
      },
    ])
  })
})
