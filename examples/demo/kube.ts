/**
 * Kubernetes and Flux in the demo, for whatever the catalog names: each service's workload and pods in its namespace,
 * running the image its environment is on, loyalty labelled for the catalog's rule to find, Flux's kustomizations and
 * image policies, and the stock count's CronJob. In production, inventory's image policy cannot list tags.
 */
import type { Catalog } from "../../src/shared/catalog"
import { type Environment, minutesAgo, seedOf } from "./clock"
import { linesOf, tagOf } from "./story"

interface Workload {
  readonly service: string
  readonly namespace: string
  readonly kind: "Deployment" | "StatefulSet"
  readonly name: string
  readonly labels: Record<string, string>
  readonly annotations?: Record<string, string>
}

/** loyalty, which the catalog does not write: labelled so its kubernetes rule finds it. */
const loyalty: Workload = {
  service: "loyalty",
  namespace: "orders",
  kind: "Deployment",
  name: "loyalty",
  labels: { app: "loyalty", "estate.dev/show": "true", "app.kubernetes.io/part-of": "Orders", team: "orders" },
  annotations: { "estate.dev/description": "Points for every order, spent at checkout" },
}

const workloadsOf = (catalog: Catalog, environment: Environment): ReadonlyArray<Workload> => [
  ...catalog.services.flatMap((service) => {
    const kubernetes = service.runtime?.kubernetes ?? service.kubernetes
    if (kubernetes === undefined || !service.environments.includes(environment)) return []
    return kubernetes.workloads.map((workload) => ({
      service: service.name,
      namespace: kubernetes.namespace,
      kind: workload.kind === "StatefulSet" ? ("StatefulSet" as const) : ("Deployment" as const),
      name: workload.name,
      labels: { app: workload.name },
    }))
  }),
  loyalty,
]

const ready = (status: string, message?: string) => ({
  type: "Ready",
  status,
  reason: status === "True" ? "Succeeded" : "Failed",
  lastTransitionTime: minutesAgo(40),
  ...(message === undefined ? {} : { message }),
})

const replicasOf = (workload: Workload, environment: Environment) =>
  environment === "staging" ? 1 : workload.kind === "StatefulSet" ? 3 : 2 + (seedOf(workload.name) % 3)

const podsOf = (workload: Workload, environment: Environment) =>
  Array.from({ length: replicasOf(workload, environment) }, (_, index) => {
    const suffix =
      workload.kind === "StatefulSet" ? String(index) : `${(seedOf(workload.name) % 900) + 100}-${"abcde"[index]}`
    const name = `${workload.name}-${suffix}`
    // In production picking's pods have restarted while broker 4 was going.
    const restarts = environment === "production" && workload.name === "picking" ? 2 + index : 0
    return {
      metadata: { name, labels: workload.labels },
      spec: {
        nodeName: `node-${environment === "staging" ? 1 : 1 + ((seedOf(name) + index) % 6)}`,
        containers: [{ image: `registry.larder.example/${workload.service}:${tagOf(workload.service, environment)}` }],
      },
      status: {
        phase: "Running",
        startTime: minutesAgo(restarts > 0 ? 8 : 300 + (seedOf(name) % 2000)),
        conditions: [ready("True")],
        containerStatuses: [{ restartCount: restarts }],
      },
    }
  })

const asResource = (workload: Workload) => ({
  metadata: {
    name: workload.name,
    namespace: workload.namespace,
    labels: workload.labels,
    ...(workload.annotations === undefined ? {} : { annotations: workload.annotations }),
  },
  spec: { selector: { matchLabels: { app: workload.name } } },
})

let logged = 0

/** The cluster's answer to a path and its query, or undefined where it is not one the demo plays. */
export const kubeAnswer = (catalog: Catalog, environment: Environment, url: URL): unknown => {
  const path = url.pathname
  const workloads = workloadsOf(catalog, environment)
  const listed = /^\/apis\/apps\/v1\/namespaces\/([\w-]+)\/(deployments|statefulsets)$/.exec(path)
  if (listed !== null) {
    const [, namespace, plural] = listed
    const selector = url.searchParams.get("labelSelector")
    return {
      items: workloads
        .filter((workload) => workload.namespace === namespace)
        .filter((workload) => (plural === "deployments") === (workload.kind === "Deployment"))
        .filter(
          (workload) =>
            selector === null ||
            selector.split(",").every((term) => {
              const [key, value] = term.split("=")
              return key !== undefined && workload.labels[key] === value
            }),
        )
        .map(asResource),
    }
  }
  const pods = /^\/api\/v1\/namespaces\/([\w-]+)\/pods$/.exec(path)?.[1]
  if (pods !== undefined)
    return {
      items: workloads.filter((workload) => workload.namespace === pods).flatMap((each) => podsOf(each, environment)),
    }
  const log = /^\/api\/v1\/namespaces\/[\w-]+\/pods\/([\w-]+)\/log$/.exec(path)?.[1]
  if (log !== undefined) {
    logged += 1
    const owner = workloads.find((workload) => log.startsWith(`${workload.name}-`))
    return `${linesOf(owner?.service ?? log, environment, log, logged).join("\n")}\n`
  }
  if (path.endsWith("/namespaces/flux-system/kustomizations"))
    return {
      items: [...new Set(catalog.services.flatMap((service) => service.deploy?.flux?.kustomization ?? []))].map(
        (name) => ({
          metadata: { name },
          status: {
            lastAppliedRevision: `main@sha1:${tagOf(name, environment).slice(-7)}`,
            conditions: [ready("True")],
          },
        }),
      ),
    }
  if (path.endsWith("/namespaces/flux-system/imagepolicies"))
    return {
      items: catalog.services.flatMap((service) => {
        const policy = service.deploy?.flux?.imagePolicy
        if (policy === undefined) return []
        const stuck = environment === "production" && service.name === "inventory"
        return [
          {
            metadata: { name: policy },
            status: {
              latestRef: { tag: tagOf(service.name, environment) },
              conditions: [
                stuck
                  ? ready(
                      "False",
                      "cannot list tags: GET registry.larder.example/v2/inventory/tags/list: 401 Unauthorized",
                    )
                  : ready("True"),
              ],
            },
          },
        ]
      }),
    }
  const cron = /^\/apis\/batch\/v1\/namespaces\/[\w-]+\/cronjobs\/([\w-]+)$/.exec(path)?.[1]
  if (cron !== undefined)
    return {
      spec: { schedule: "15 3 * * *" },
      status: { lastScheduleTime: new Date(new Date().setUTCHours(3, 15, 0, 0)).toISOString() },
    }
  if (/^\/apis\/batch\/v1\/namespaces\/[\w-]+\/jobs$/.test(path))
    return {
      items: [
        {
          metadata: { name: "stock-count-29170", ownerReferences: [{ kind: "CronJob", name: "stock-count" }] },
          status: { startTime: minutesAgo(600), completionTime: minutesAgo(571), succeeded: 1 },
        },
      ],
    }
  return undefined
}
