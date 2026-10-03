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
        },
        { name: "orders", environments: [] },
      ],
      vitals: [{ title: "Orders", query: "sum(rate(orders_total[1m])))" }],
      map: {
        nodes: [{ id: "a", service: "carts" }, { id: "a" }],
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
      "services[0] (orders).links.logs: {cluster} is not one of {env}, {namespace}, {service}",
      "services[0] (orders).debug.levels: needs the usual level and the debug level, in that order",
      'services[0] (orders).repository: "gitlab.com/example/orders" is not github:owner/name',
      "vitals[0] (Orders): the query has an unmatched )",
      'map.nodes: "a" is named twice',
      'map.nodes[0] (a): "carts" is not a service',
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
    ).toEqual([{ at: "services[0] (s).jobs", message: "needs kubernetes.namespace, where its jobs run" }])
  })
})
