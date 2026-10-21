import { describe, expect, test } from "bun:test"
import { Result } from "effect"
import { checkCatalog } from "./check"

const catalog = (extra: Record<string, unknown>) => ({
  environments: [{ name: "production", sources: "production" }],
  services: [],
  ...extra,
})

const mistakes = (input: unknown) => {
  const checked = checkCatalog(input)
  return Result.isFailure(checked) ? checked.failure : []
}

describe("a discover rule", () => {
  test("finds workloads by a label selector, filling its entry from each", () => {
    expect(
      mistakes(
        catalog({
          discover: [
            {
              kubernetes: { selector: "estate.dev/show=true", namespaces: ["shop"] },
              service: {
                category: "{label:app.kubernetes.io/part-of}",
                runbook: "{annotation:estate.dev/runbook}",
                load: { requests: 'sum(rate(http_requests_total{app="{name}"}[1m]))' },
                links: { logs: "https://logs.example/{env}/{namespace}/{service}" },
                logs: { mask: ["token=\\S+", "{label:secret-pattern}"] },
              },
            },
          ],
        }),
      ),
    ).toEqual([])
  })

  test("needs a selector, and names only what a workload has", () => {
    expect(
      mistakes(
        catalog({
          discover: [{ kubernetes: { selector: " " }, service: { owner: "{lable:team}", category: "{team}" } }],
        }),
      ),
    ).toEqual([
      { at: "discover[0].kubernetes.selector", message: "is empty; discovery finds only workloads labelled so" },
      {
        at: "discover[0].service.owner",
        message: "{lable:team} is not one of {name}, {namespace}, {service}, {label:KEY} or {annotation:KEY}",
      },
      {
        at: "discover[0].service.category",
        message: "{team} is not one of {name}, {namespace}, {service}, {label:KEY} or {annotation:KEY}",
      },
    ])
  })

  test("is the only thing that marks a service discovered", () => {
    expect(
      mistakes(
        catalog({
          services: [{ name: "orders", environments: ["production"], discovered: { from: "kubernetes" } }],
        }),
      ),
    ).toEqual([{ at: "services[0] (orders).discovered", message: "is set by discovery, never written" }])
  })

  test("names one place to discover from, and only environments the catalog has", () => {
    expect(
      mistakes(
        catalog({
          discover: [
            { kubernetes: { selector: "a=b" }, backstage: {} },
            {},
            { backstage: { filter: "kind=component" }, service: { environments: ["production", "moon"] } },
          ],
        }),
      ),
    ).toEqual([
      { at: "discover[0]", message: "names where to discover: kubernetes, backstage or kafka, one" },
      { at: "discover[1]", message: "names where to discover: kubernetes, backstage or kafka, one" },
      { at: "discover[2].service.environments", message: '"moon" is not an environment' },
    ])
  })
})

describe("a Kafka discover rule", () => {
  test("finds clusters by the labels that tell them apart, filling a store from each", () => {
    expect(
      mistakes(
        catalog({
          discover: [
            {
              kafka: { by: ["namespace", "strimzi_io_cluster"], selector: 'job="kafka-exporter"' },
              store: {
                name: "{label:strimzi_io_cluster}",
                category: "Data",
                links: { dashboard: "https://grafana.{env}.example/d/kafka?var-cluster={label:strimzi_io_cluster}" },
              },
            },
          ],
        }),
      ),
    ).toEqual([])
  })

  test("needs its labels, and names only those", () => {
    expect(
      mistakes(
        catalog({
          discover: [
            { kafka: { by: [] } },
            {
              kafka: { by: ["cluster"] },
              store: { name: "{label:team}", description: "{name}", links: { logs: "https://{env}/{label:pod}" } },
            },
          ],
        }),
      ),
    ).toEqual([
      { at: "discover[0].kafka.by", message: "is empty; name the labels that tell one cluster from another" },
      { at: "discover[1].store.name", message: "{label:team} is not one of the rule's labels: {label:cluster}" },
      { at: "discover[1].store.description", message: "{name} is not one of the rule's labels: {label:cluster}" },
      { at: "discover[1].store.links.logs", message: "{label:pod} is not one of the rule's labels: {label:cluster}" },
    ])
  })

  test("fills a store, and only it does", () => {
    expect(
      mistakes(
        catalog({
          discover: [
            { kafka: { by: ["cluster"] }, service: { category: "Data" } },
            { kubernetes: { selector: "a=b" }, store: { category: "Data" } },
          ],
        }),
      ),
    ).toEqual([
      { at: "discover[0].service", message: "is for services; a kafka rule fills a store:" },
      { at: "discover[1].store", message: "is filled only by a kafka rule" },
    ])
  })

  test("is the only thing that marks a store discovered", () => {
    expect(
      mistakes(
        catalog({
          stores: [
            {
              name: "bus",
              environments: ["production"],
              engine: "kafka",
              selector: 'job="kafka"',
              discovered: { from: "prometheus" },
            },
          ],
        }),
      ),
    ).toEqual([{ at: "stores[0] (bus).discovered", message: "is set by discovery, never written" }])
  })
})
