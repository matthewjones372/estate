/**
 * Tools that answer for any number of services, as Prometheus, Alertmanager, Kubernetes and Flux would: the same
 * answer for the same question, each after `latency` milliseconds, counting every call.
 */
const pod = (name: string, app: string) => ({
  metadata: { name, labels: { app } },
  spec: { nodeName: "n1", containers: [{ image: `registry.example/${app}:v1` }] },
  status: {
    phase: "Running",
    startTime: "2026-10-03T06:00:00Z",
    conditions: [{ type: "Ready", status: "True" }],
    containerStatuses: [{ restartCount: 0 }],
  },
})

const ready = { type: "Ready", status: "True", lastTransitionTime: "2026-10-03T06:00:00Z" }

/** A point for each step of the range, the same for the same query and time, as a real Prometheus answers. */
const range = (url: URL) => {
  const start = Number(url.searchParams.get("start"))
  const end = Number(url.searchParams.get("end"))
  const step = Number(url.searchParams.get("step"))
  const seed = Number(Bun.hash(url.searchParams.get("query") ?? "") % 1000n)
  const values: Array<[number, string]> = []
  for (let at = start; at <= end; at += step) values.push([at, String(50 + 40 * Math.sin(at / 900 + seed))])
  return { status: "success", data: { resultType: "matrix", result: [{ metric: {}, values }] } }
}

const firing = Array.from({ length: 5 }, (_, index) => ({
  labels: { alertname: `Alert${index}`, app: `svc-${index}`, severity: "warning" },
  annotations: { summary: `svc-${index} needs someone` },
  startsAt: "2026-10-03T06:00:00Z",
  status: { state: "active", silencedBy: [], inhibitedBy: [] },
}))

export interface Tools {
  readonly url: string
  readonly calls: () => number
  readonly stop: () => void
}

export const startTools = (services: number, latency: number): Tools => {
  const names = Array.from({ length: services }, (_, index) => `svc-${index}`)
  const answer = (url: URL): unknown => {
    const path = url.pathname
    if (path === "/api/v1/query_range") return range(url)
    if (path === "/api/v1/rules") return { status: "success", data: { groups: [] } }
    if (path === "/api/v1/alerts") return { status: "success", data: { alerts: [] } }
    if (path === "/api/v2/alerts") return firing
    if (path === "/api/v2/silences") return []
    if (path.endsWith("/deployments"))
      return {
        items: names.map((name) => ({ metadata: { name }, spec: { selector: { matchLabels: { app: name } } } })),
      }
    if (path.endsWith("/pods"))
      return { items: names.flatMap((name) => ["a", "b"].map((x) => pod(`${name}-${x}`, name))) }
    if (path.endsWith("/kustomizations"))
      return {
        items: [{ metadata: { name: "shop" }, status: { lastAppliedRevision: "main@sha1:abc", conditions: [ready] } }],
      }
    if (path.endsWith("/imagepolicies"))
      return {
        items: names.map((name) => ({ metadata: { name }, status: { latestRef: { tag: "v1" }, conditions: [ready] } })),
      }
    return undefined
  }
  let calls = 0
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      calls += 1
      await Bun.sleep(latency)
      const body = answer(new URL(request.url))
      return body === undefined ? Response.json({ message: "not found" }, { status: 404 }) : Response.json(body)
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, calls: () => calls, stop: () => server.stop(true) }
}
