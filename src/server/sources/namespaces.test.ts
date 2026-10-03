import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted, Result } from "effect"
import type { Service } from "../../shared/catalog"
import { platform } from "../platform"
import { type Call, type Remote, stubRemote } from "../remote"
import type { Chosen } from "../state"
import { answering } from "./answers"
import { readCluster } from "./cluster"
import { readDeploys } from "./flux"
import { type Cluster, clusterOf } from "./kubernetes"

const run = <A, E>(read: (cluster: Cluster) => Effect.Effect<A, E, Remote>, calls: Call[]) =>
  Effect.runPromise(
    Effect.result(
      Effect.flatMap(clusterOf({ url: "https://cluster", token: Redacted.make("t") }), read).pipe(
        Effect.provide(Layer.merge(stubRemote(answering(undefined, calls)), platform)),
      ),
    ),
  )

const inShop = (
  name: string,
  workload = name,
  flux: { kustomization: string; imagePolicy?: string } = { kustomization: "shop" },
): Service => ({
  name,
  environments: [],
  kubernetes: { namespace: "shop", workloads: [{ kind: "Deployment", name: workload }] },
  deploy: { flux },
})

describe("a namespace", () => {
  test("is listed once per read however many services live in it, and a workload not there selects nothing", () => {
    const calls: Call[] = []
    const services = [
      inShop("storefront"),
      inShop("missing"),
      inShop("empty", "selects-nothing"),
      ...Array.from({ length: 20 }, (_, index) => inShop(`more-${index}`)),
    ]
    return run((cluster) => readCluster(cluster, services), calls).then((read) => {
      const pods = Result.isSuccess(read) ? read.success.pods : {}
      expect(pods["storefront"]?.map((pod) => pod.name)).toEqual(["storefront-1", "storefront-2"])
      expect(pods["missing"]).toEqual([])
      expect(pods["empty"]).toEqual([])
      expect(calls.map((call) => new URL(call.url).pathname).filter((path) => !path.includes("configmaps"))).toEqual([
        "/apis/apps/v1/namespaces/shop/deployments",
        "/api/v1/namespaces/shop/pods",
      ])
    })
  })

  test("of Flux's is listed once too, and says when what a service names is not there", () => {
    const calls: Call[] = []
    const services = [
      inShop("storefront", "storefront", { kustomization: "shop", imagePolicy: "storefront" }),
      inShop("orders", "orders", { kustomization: "elsewhere" }),
      inShop("search", "search", { kustomization: "shop", imagePolicy: "search" }),
    ]
    return run((cluster) => readDeploys(cluster, services), calls).then((read) => {
      const chosen: Readonly<Record<string, Chosen>> = Result.isSuccess(read) ? read.success : {}
      expect(chosen["storefront"]?.version).toBe("v3")
      expect(chosen["orders"]).toEqual({
        version: "unknown",
        ready: false,
        stalled: "Flux has no Kustomization elsewhere in flux-system",
      })
      expect(chosen["search"]?.stalled).toBe("Flux has no ImagePolicy search in flux-system")
      expect(calls.filter((call) => call.url.includes("kustomizations"))).toHaveLength(1)
    })
  })
})
