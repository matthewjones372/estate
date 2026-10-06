import { describe, expect, test } from "bun:test"
import { Effect, type FileSystem, Layer, Redacted, Ref, Result, SubscriptionRef } from "effect"
import type { Catalog, DiscoverRule } from "../../shared/catalog"
import { checkCatalog } from "../../shared/check"
import { catalog, estate, settings } from "../fixture"
import { platform } from "../platform"
import { type Call, type Remote, reply, stubRemote } from "../remote"
import type { Settings } from "../settings"
import { Estate, estateLayer } from "../state"
import { catalogView } from "../views/catalog"
import { discoverOnce, makeCatalogs, written } from "./run"

const rule: DiscoverRule = {
  kubernetes: { selector: "estate.dev/show=true", namespaces: ["shop"] },
  service: {
    category: "{label:app.kubernetes.io/part-of}",
    owner: "{label:team}",
    load: { requests: 'sum(rate(http_requests_total{app="{name}"}[1m]))' },
    links: { logs: "https://logs.example/{env}/{namespace}/{service}" },
  },
}

const written0: Catalog = { ...catalog, discover: [rule] }

const clustered: Settings = {
  ...settings(),
  sources: {
    staging: { kubernetes: { url: "https://staging", token: Redacted.make("t") } },
    production: { kubernetes: { url: "https://production", token: Redacted.make("t") } },
  },
}

const workload = (name: string, labels: Record<string, string> = {}, annotations: Record<string, string> = {}) => ({
  metadata: { name, namespace: "shop", labels: { "estate.dev/show": "true", ...labels }, annotations },
})

/** Two clusters: basket in both, a mistaken one in production only, and the written storefront labelled too. */
const clusters =
  (calls: Array<string>, down = new Set<string>()) =>
  (call: Call) => {
    const url = new URL(call.url)
    calls.push(`${url.host}${url.pathname}${url.search}`)
    if (down.has(url.host)) return reply({ message: "down" }, 503)
    if (url.pathname.endsWith("/statefulsets")) return reply({ items: [] })
    return reply({
      items: [
        workload(
          "basket-7f",
          { "app.kubernetes.io/name": "basket", "app.kubernetes.io/part-of": "shop", team: "web" },
          { "estate.dev/runbook": "https://runbooks.example/basket", "estate.dev/repository": "github:acme/basket" },
        ),
        workload("storefront"),
        ...(url.host === "production" ? [workload("odd", {}, { "estate.dev/repository": "not a repo" })] : []),
      ],
    })
  }

const run = <A>(
  effect: Effect.Effect<A, never, Estate | Remote | FileSystem.FileSystem>,
  answer: (call: Call) => ReturnType<typeof reply>,
) =>
  effect.pipe(
    Effect.provide(estateLayer(estate({ catalog: written0 }))),
    Effect.provide(Layer.merge(stubRemote(answer), platform)),
  )

describe("discovered services", () => {
  test("are each labelled workload as one service in every environment it is in, filled from its labels", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: Array<string> = []
        const shown = yield* run(
          Effect.gen(function* () {
            const catalogs = yield* makeCatalogs(written0)
            yield* discoverOnce(catalogs, clustered)
            return (yield* SubscriptionRef.get(yield* Estate)).catalog
          }),
          clusters(calls),
        )
        expect(calls).toContain(
          "staging/apis/apps/v1/namespaces/shop/deployments?labelSelector=estate.dev%2Fshow%3Dtrue",
        )
        expect(shown.services.map((service) => service.name)).toEqual([
          "storefront",
          "orders",
          "payments",
          "search",
          "basket",
        ])
        expect(shown.services.at(-1)).toEqual({
          name: "basket",
          environments: ["staging", "production"],
          category: "shop",
          owner: "web",
          load: { requests: 'sum(rate(http_requests_total{app="basket"}[1m]))' },
          links: { logs: "https://logs.example/{env}/shop/basket" },
          runbook: "https://runbooks.example/basket",
          repository: "github:acme/basket",
          kubernetes: { namespace: "shop", workloads: [{ kind: "Deployment", name: "basket-7f" }] },
          discovered: { from: "kubernetes" },
        })
        // The written storefront wins whole, and odd, whose repository is a mistake, is left out.
        expect(shown.services[0]?.discovered).toBeUndefined()
        expect(shown.services.some((service) => service.name === "odd")).toBe(false)
      }),
    ))

  test("are kept when a cluster stops answering, and when the catalog file is reloaded", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const down = new Set<string>()
        const names = yield* run(
          Effect.gen(function* () {
            const catalogs = yield* makeCatalogs(written0)
            yield* discoverOnce(catalogs, clustered)
            down.add("production")
            yield* discoverOnce(catalogs, clustered)
            yield* written(catalogs, clustered)({ ...written0, services: written0.services.slice(0, 1) })
            const shown = (yield* SubscriptionRef.get(yield* Estate)).catalog
            return [shown.services.map((service) => service.name), yield* Ref.get(catalogs.said)]
          }),
          clusters([], down),
        )
        expect(names).toEqual([["storefront", "basket"], ""])
      }),
    ))

  test("are none without a rule, or where an environment is not read from Kubernetes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: Array<string> = []
        const shown = yield* run(
          Effect.gen(function* () {
            const catalogs = yield* makeCatalogs(catalog)
            yield* discoverOnce(catalogs, clustered)
            yield* written(catalogs, settings())({ ...catalog, discover: [rule] })
            yield* discoverOnce(catalogs, settings())
            return (yield* SubscriptionRef.get(yield* Estate)).catalog
          }),
          clusters(calls),
        )
        expect(calls).toEqual([])
        expect(shown.services.map((service) => service.name)).toEqual(["storefront", "orders", "payments", "search"])
      }),
    ))

  test("are offered to the page as YAML that is a catalog entry, marked only by where they were found", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const shown = yield* run(
          Effect.gen(function* () {
            const catalogs = yield* makeCatalogs(written0)
            yield* discoverOnce(catalogs, clustered)
            return (yield* SubscriptionRef.get(yield* Estate)).catalog
          }),
          clusters([]),
        )
        const basket = catalogView(shown, "production").services.find((service) => service.name === "basket")
        expect(basket?.discovered?.from).toBe("kubernetes")
        const pasted = Bun.YAML.parse(`services:\n${(basket?.discovered?.yaml ?? "").replace(/^/gm, "  ")}`)
        const checked = checkCatalog({ environments: catalog.environments, ...(pasted as object) })
        expect(Result.isSuccess(checked) && checked.success.services[0]?.name).toBe("basket")
        expect(catalogView(shown, "production").services[0]?.discovered).toBeUndefined()
      }),
    ))
})
