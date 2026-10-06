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
})
