/** The fake estate's cluster, as e2e/tools.ts answers it: each namespace's workloads and pods, Flux, and jobs. */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const condition = (status: string, message?: string) => ({
  type: "Ready",
  status,
  reason: status === "True" ? "Succeeded" : "Failed",
  lastTransitionTime: minutesAgo(34),
  ...(message === undefined ? {} : { message }),
})

const pod = (name: string, image: string) => ({
  metadata: { name },
  spec: { nodeName: ["one", "two", "three"][name.length % 3], containers: [{ image }] },
  status: {
    phase: "Running",
    startTime: minutesAgo(180),
    conditions: [condition("True")],
    containerStatuses: [{ restartCount: 0 }],
  },
})

const workload = (name: string) => ({ metadata: { name }, spec: { selector: { matchLabels: { app: name } } } })
const pods = (app: string, names: ReadonlyArray<string>, image: string) =>
  names.map((name) => ({ ...pod(name, image), metadata: { name, labels: { app } } }))

/** basket, which the catalog does not name: labelled for its discover rule to find. */
const basket = {
  ...workload("basket"),
  metadata: {
    name: "basket",
    namespace: "shop",
    labels: { "estate.dev/show": "true", "app.kubernetes.io/part-of": "Shop", team: "web" },
    annotations: { "estate.dev/description": "Keeps what each customer means to buy" },
  },
}

export const kube: Record<string, () => unknown> = {
  "/apis/apps/v1/namespaces/shop/deployments": () => ({
    items: [...["storefront", "orders", "search"].map(workload), basket],
  }),
  "/apis/apps/v1/namespaces/shop/deployments?labelSelector=estate.dev%2Fshow%3Dtrue": () => ({ items: [basket] }),
  "/apis/apps/v1/namespaces/shop/statefulsets?labelSelector=estate.dev%2Fshow%3Dtrue": () => ({ items: [] }),
  "/apis/apps/v1/namespaces/payments/statefulsets": () => ({ items: [workload("payments")] }),
  "/api/v1/namespaces/shop/pods": () => ({
    items: [
      ...pods(
        "storefront",
        ["storefront-7d9f-a", "storefront-7d9f-b", "storefront-7d9f-c"],
        "registry.example/storefront:main-212-c556728",
      ),
      ...pods("orders", ["orders-5c4-a", "orders-5c4-b"], "registry.example/orders:main-87-3889c5c"),
      ...pods("search", ["search-0"], "registry.example/search:1.4.2"),
      ...pods("basket", ["basket-6b8-a", "basket-6b8-b"], "registry.example/basket:main-14-6b8e2d1"),
    ],
  }),
  "/api/v1/namespaces/payments/pods": () => ({
    items: pods("payments", ["payments-0"], "registry.example/payments:main-31-17edba9"),
  }),
  "/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations": () => ({
    items: [
      {
        metadata: { name: "shop" },
        status: { lastAppliedRevision: "main@sha1:c556728aa", conditions: [condition("True")] },
      },
    ],
  }),
  "/apis/image.toolkit.fluxcd.io/v1/namespaces/flux-system/imagepolicies": () => ({
    items: [
      {
        metadata: { name: "storefront" },
        status: { latestRef: { tag: "main-212-c556728" }, conditions: [condition("True")] },
      },
      {
        metadata: { name: "orders" },
        status: {
          latestRef: { tag: "main-88-04bc441" },
          conditions: [
            condition("False", "cannot list tags: GET registry.example/v2/orders/tags/list: 401 Unauthorized"),
          ],
        },
      },
    ],
  }),
  "/apis/batch/v1/namespaces/shop/cronjobs/orders-nightly-export": () => ({
    spec: { schedule: "30 2 * * *" },
    status: { lastScheduleTime: new Date(new Date().setUTCHours(2, 30, 0, 0)).toISOString() },
  }),
  "/apis/batch/v1/namespaces/batch/cronjobs/payments-settlement": () => ({
    spec: { schedule: "0 1 * * *" },
    status: { lastScheduleTime: new Date(new Date().setUTCHours(1, 0, 0, 0)).toISOString() },
  }),
  "/apis/batch/v1/namespaces/batch/jobs": () => ({
    items: [
      {
        metadata: {
          name: "payments-settlement-1",
          ownerReferences: [{ kind: "CronJob", name: "payments-settlement" }],
        },
        status: { startTime: minutesAgo(700), completionTime: minutesAgo(688), succeeded: 1 },
      },
    ],
  }),
  "/apis/batch/v1/namespaces/shop/jobs": () => ({
    items: [
      {
        metadata: {
          name: "orders-nightly-export-1",
          ownerReferences: [{ kind: "CronJob", name: "orders-nightly-export" }],
        },
        status: { startTime: minutesAgo(600), completionTime: minutesAgo(596), succeeded: 1 },
      },
    ],
  }),
}
