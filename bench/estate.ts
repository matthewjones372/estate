/** Estate started as its own process against the bench's tools, with a catalog of any number of services. */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const freePort = () => {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
  const { port } = server
  server.stop(true)
  return port
}

const areas = ["Shop", "Payments", "Search", "Data", "Platform"]

const catalogOf = (services: number) => {
  const each = Array.from(
    { length: services },
    (_, index) => `  - name: svc-${index}
    category: ${areas[index % areas.length]}
    environments: [ staging, production ]
    kubernetes: { namespace: shop, workloads: [ { kind: Deployment, name: svc-${index} } ] }
    deploy: { flux: { kustomization: shop, imagePolicy: svc-${index} } }
    load:
      requests: sum(rate(http_requests_total{app="svc-${index}"}[1m]))
      errors: sum(rate(http_requests_total{app="svc-${index}",code=~"5.."}[1m]))
      p99: histogram_quantile(0.99, sum by (le) (rate(duration_bucket{app="svc-${index}"}[5m])))
    links: { logs: "https://logs.example/{env}/{service}" }`,
  )
  // A map of every service, shaped as an estate is: the first service calls the front service of each area, which
  // calls the rest of its area. Past twelve nodes it draws as its areas.
  const nodes = Array.from({ length: services }, (_, index) => `    - { id: svc-${index}, service: svc-${index} }`)
  const front = (index: number) => index % areas.length
  const edges = Array.from({ length: services }, (_, index) => index)
    .filter((index) => index > 0)
    .map((index) => `    - { from: svc-${index < areas.length ? 0 : front(index)}, to: svc-${index} }`)
  return `environments:
  - { name: staging, sources: staging }
  - { name: production, sources: production }
services:
${each.join("\n")}
map:
  nodes:
${nodes.join("\n")}
  edges:
${edges.length === 0 ? "    []" : edges.join("\n")}
`
}

const settingsOf = (dir: string, port: number, metrics: number, tools: string) => {
  const section = `    prometheus: { url: ${tools} }
    alertmanager: { url: ${tools} }
    kubernetes: { url: ${tools}, token: bench }
    flux: {}`
  return `port: ${port}
host: 127.0.0.1
metrics: { port: ${metrics} }
catalog: ${join(dir, "catalog.yaml")}
auth:
  sessionSecret: a-secret-for-the-bench-only-not-for-use
  roles: { viewer: [ bench ], operator: [ ] }
  anonymous: { name: bench, role: viewer }
sources:
  staging:
${section}
  production:
${section}
`
}

export interface Running {
  readonly url: string
  readonly pid: number
  readonly log: string
  readonly stop: () => void
}

export const startEstate = async (services: number, tools: string): Promise<Running> => {
  const dir = mkdtempSync(join(tmpdir(), "estate-bench-"))
  const port = freePort()
  await Bun.write(join(dir, "catalog.yaml"), catalogOf(services))
  await Bun.write(join(dir, "estate.yaml"), settingsOf(dir, port, freePort(), tools))
  const log = join(dir, "estate.log")
  const output = Bun.file(log)
  const child = Bun.spawn(["bun", "src/server/main.ts"], {
    env: { ...process.env, ESTATE_SETTINGS: join(dir, "estate.yaml"), ESTATE_LOG_FORMAT: "json" },
    stdout: output,
    stderr: output,
  })
  const url = `http://127.0.0.1:${port}`
  for (let tries = 0; tries < 120; tries++) {
    const healthy = await fetch(`${url}/healthz`).then(
      (response) => response.ok,
      () => false,
    )
    if (healthy) return { url, pid: child.pid, log, stop: () => child.kill() }
    await Bun.sleep(500)
  }
  child.kill()
  throw new Error(`Estate did not start; its log is ${log}`)
}
