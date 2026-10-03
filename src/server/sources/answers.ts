/** What an estate's tools answer, in their own shapes: Alertmanager, Prometheus, Kubernetes and Flux, for tests. */
import { type Call, type Reply, reply } from "../remote"

const condition = (type: string, status: string, message?: string) => ({
  type,
  status,
  reason: status === "True" ? "Succeeded" : "Failed",
  lastTransitionTime: "2026-10-03T11:20:00Z",
  ...(message === undefined ? {} : { message }),
})

const pod = (name: string, ready: boolean, restarts = 0) => ({
  metadata: { name },
  spec: { nodeName: "one", containers: [{ image: "registry.example/storefront:v2" }] },
  status: {
    phase: "Running",
    startTime: "2026-10-03T10:00:00Z",
    conditions: [condition("Ready", ready ? "True" : "False")],
    containerStatuses: [{ restartCount: restarts }],
  },
})

const answers: Readonly<Record<string, unknown>> = {
  "http://alertmanager/api/v2/alerts?active=true&silenced=true&inhibited=false": [
    {
      labels: { alertname: "OrdersSlow", severity: "warning", app: "orders" },
      annotations: { summary: "Orders are slow", runbook_url: "https://runbooks.example/orders-slow" },
      startsAt: "2026-10-03T11:46:00Z",
      status: { state: "active", silencedBy: [], inhibitedBy: [] },
    },
    {
      labels: { alertname: "DiskFilling", namespace: "shop" },
      annotations: { description: "The disk fills" },
      startsAt: "2026-10-03T09:00:00Z",
      status: { state: "suppressed", silencedBy: ["s1"], inhibitedBy: [] },
    },
  ],
  "http://alertmanager/api/v2/silences": [
    {
      id: "s1",
      createdBy: "ada",
      comment: "resizing",
      startsAt: "2026-10-03T09:05:00Z",
      endsAt: "2026-10-03T15:00:00Z",
      status: { state: "active" },
    },
  ],
  "http://prometheus/api/v1/alerts": {
    status: "success",
    data: {
      alerts: [
        {
          labels: { alertname: "QueueGrowing", severity: "critical", app: "orders" },
          annotations: {},
          state: "pending",
          activeAt: "2026-10-03T11:58:00Z",
        },
        {
          labels: { alertname: "OrdersSlow", severity: "warning", app: "orders" },
          annotations: {},
          state: "firing",
          activeAt: "2026-10-03T11:46:00Z",
        },
      ],
    },
  },
  "https://cluster/apis/apps/v1/namespaces/shop/deployments/storefront": {
    spec: { selector: { matchLabels: { app: "storefront" } } },
  },
  "https://cluster/api/v1/namespaces/shop/pods?labelSelector=app%3Dstorefront": {
    items: [pod("storefront-1", true), pod("storefront-2", false, 3)],
  },
  "https://cluster/api/v1/namespaces/shop/configmaps/storefront-logging": {
    metadata: {
      name: "storefront-logging",
      annotations: {
        "estate.dev/debug-until": "2026-10-03T12:05:00Z",
        "estate.dev/debug-by": "ada",
        "estate.dev/debug-since": "2026-10-03T11:50:00Z",
      },
    },
    data: { level: "DEBUG" },
  },
  "https://cluster/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/flux-system/kustomizations/shop": {
    status: { lastAppliedRevision: "main@sha1:0123456789abcdef", conditions: [condition("Ready", "True")] },
  },
  "https://cluster/apis/image.toolkit.fluxcd.io/v1beta2/namespaces/flux-system/imagepolicies/storefront": {
    status: {
      latestRef: { tag: "v3" },
      conditions: [condition("Ready", "False", "cannot list tags: 401 Unauthorized")],
    },
  },
}

/** Answers from the table, recording each call. */
export const answering =
  (table: Readonly<Record<string, unknown>> = answers, calls: Call[] = []) =>
  (call: Call): Reply | undefined => {
    calls.push(call)
    const body = table[call.url]
    return body === undefined ? undefined : reply(body)
  }
