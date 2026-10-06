import { describe, expect, test } from "bun:test"
import { Effect, type FileSystem, Layer, Redacted, SubscriptionRef } from "effect"
import type { Catalog } from "../../shared/catalog"
import { backstageFinding } from "../doctor-discover"
import { catalog, estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, type Remote, reply, stubRemote } from "../remote"
import type { Settings } from "../settings"
import { Estate, estateLayer } from "../state"
import { discoverOnce, makeCatalogs } from "./run"

const written: Catalog = {
  ...catalog,
  discover: [
    { backstage: {}, service: { load: { requests: 'sum(rate(http_requests_total{app="{name}"}[1m]))' } } },
    { kubernetes: { selector: "estate.dev/show=true" } },
  ],
}

const withBackstage: Settings = {
  ...settings(),
  backstage: { url: "https://backstage.example/", token: Redacted.make("bs-token") },
  sources: { staging: {}, production: { kubernetes: { url: "https://production", token: Redacted.make("t") } } },
}

const component = (name: string, extra: Record<string, unknown> = {}) => ({
  metadata: { name, ...extra },
  spec: { type: "service", owner: "group:default/web", system: "Shop" },
})

/** A Backstage of two pages, and a cluster with recommendations in it as well. */
const tools =
  (calls: Array<Call>, down = false) =>
  (call: Call) => {
    calls.push(call)
    const url = new URL(call.url)
    if (url.host === "production")
      return reply({
        items: url.pathname.endsWith("/deployments")
          ? [{ metadata: { name: "recommendations", namespace: "shop", labels: { "estate.dev/show": "true" } } }]
          : [],
      })
    if (down) return reply({ error: "down" }, 503)
    return url.searchParams.has("cursor")
      ? reply({ items: [component("legacy-billing", { annotations: { "github.com/project-slug": "not a slug!" } })] })
      : reply({
          items: [
            component("recommendations", {
              description: "Suggests what to buy next",
              annotations: {
                "github.com/project-slug": "acme/recommendations",
                "backstage.io/kubernetes-namespace": "shop",
                "backstage.io/kubernetes-id": "recommendations-api",
              },
              links: [
                { url: "https://runbooks.example/recommendations", title: "Runbook" },
                { url: "https://grafana.example/d/recs", title: "Grafana dashboard" },
              ],
            }),
            component("storefront"),
          ],
          pageInfo: { nextCursor: "page-2" },
        })
  }

const run = <A>(
  effect: Effect.Effect<A, never, Estate | Remote | FileSystem.FileSystem>,
  answer: (call: Call) => ReturnType<typeof reply>,
) =>
  effect.pipe(
    Effect.provide(estateLayer(estate({ catalog: written }))),
    Effect.provide(Layer.merge(stubRemote(answer), platform)),
  )

const discovered = (calls: Array<Call>, down = false) =>
  run(
    Effect.gen(function* () {
      const catalogs = yield* makeCatalogs(written)
      yield* discoverOnce(catalogs, withBackstage)
      if (down) yield* discoverOnce(catalogs, withBackstage).pipe(Effect.provide(stubRemote(tools([], true))))
      return (yield* SubscriptionRef.get(yield* Estate)).catalog
    }),
    tools(calls),
  )

describe("services found in Backstage", () => {
  test("are its Components, every page, each the entry its owner, system, links and annotations say", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: Array<Call> = []
        const shown = yield* discovered(calls)
        const asked = calls.filter((call) => call.url.startsWith("https://backstage.example"))
        expect(asked.map((call) => new URL(call.url).search)).toEqual([
          `?filter=${encodeURIComponent("kind=component,spec.type=service")}&limit=500`,
          "?cursor=page-2",
        ])
        expect(asked[0]?.headers?.["authorization"]).toBe("Bearer bs-token")
        expect(shown.services.find((service) => service.name === "recommendations")).toEqual({
          name: "recommendations",
          environments: ["staging", "production"],
          load: { requests: 'sum(rate(http_requests_total{app="recommendations"}[1m]))' },
          description: "Suggests what to buy next",
          owner: "web",
          category: "Shop",
          repository: "github:acme/recommendations",
          runbook: "https://runbooks.example/recommendations",
          links: { "grafana-dashboard": "https://grafana.example/d/recs" },
          // Found in the cluster too, by its own workload's name: one service, Backstage's entry, both workloads.
          kubernetes: {
            namespace: "shop",
            workloads: [
              { kind: "Deployment", name: "recommendations-api" },
              { kind: "Deployment", name: "recommendations" },
            ],
          },
          discovered: { from: "backstage" },
        })
        // storefront is written, and legacy-billing's slug is not a repository, so neither is found.
        expect(shown.services.filter((service) => service.discovered !== undefined).map((each) => each.name)).toEqual([
          "recommendations",
        ])
      }),
    ))

  test("are kept when Backstage stops answering", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const shown = yield* discovered([], true)
        expect(shown.services.some((service) => service.name === "recommendations")).toBe(true)
      }),
    ))

  test("are said by the doctor for the whole estate, and not without a rule or a Backstage", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const found = yield* backstageFinding(withBackstage.backstage, written).pipe(
          Effect.provide(Layer.merge(stubRemote(tools([])), platform)),
        )
        expect(found).toEqual({
          part: "discover",
          ok: true,
          says: 'Backstage: 2 services found, 1 written over (storefront), 1 left out (legacy-billing: "github:not a slug!" is not github:owner/name)',
        })
        const none = Effect.provide(Layer.merge(stubRemote(tools([])), platform))
        expect(yield* backstageFinding(undefined, written).pipe(none)).toBeUndefined()
        expect(yield* backstageFinding(withBackstage.backstage, catalog).pipe(none)).toBeUndefined()
      }),
    ))
})
