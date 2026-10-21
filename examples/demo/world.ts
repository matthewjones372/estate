/**
 * The demo's world: every tool Estate reads, on one port, each environment a path under it. Prometheus, Alertmanager,
 * Kubernetes with Flux and Tempo answer at /production/… and /staging/…; GitHub Actions and the model at the root.
 * Its answers come from the catalog it plays for, so a service added there has pods, versions and load.
 */
import type { Catalog } from "../../src/shared/catalog"
import { at, type Environment, environments } from "./clock"
import { databaseAnswer } from "./databases"
import { clusterAsked, discovered, exporterAnswer } from "./kafka"
import { kubeAnswer } from "./kube"
import { rangeOf, seriesOf } from "./metrics"
import { modelAnswer } from "./model"
import { buildOf, changeOf, commitOf, firingIn, rulesIn } from "./story"
import { tempoAnswer } from "./traces"

const json = (body: unknown, status = 200) => Response.json(body, { status })

type Silence = { id: string; matchers: ReadonlyArray<{ name: string; value: string }> } & Record<string, unknown>

/** Prometheus's answer to an instant query: kafka_exporter's series, or any other query's value now. */
const instantOf = (environment: Environment, query: string) => {
  const vector = (result: ReadonlyArray<unknown>) => ({ status: "success", data: { resultType: "vector", result } })
  if (query.startsWith("count by") && query.includes("kafka_brokers")) return vector(discovered(environment))
  const cluster = clusterAsked(environment, query)
  if (cluster !== undefined) return vector(exporterAnswer(cluster, query))
  const database = databaseAnswer(environment, query)
  if (database !== undefined) return vector(database)
  if (query.includes("gen_ai_response_model"))
    return vector([{ metric: { gen_ai_response_model: "claude-haiku" }, value: [at(), "1"] }])
  const value = seriesOf(environment, query)
  return vector(value === undefined ? [] : [{ metric: {}, value: [at(), String(value(at()))] }])
}

/** Each build of a repository's workflow, newest first: production's build and the one before, and staging's. */
const runsOf = (repository: string) => {
  const built = [...new Set(environments.map((environment) => buildOf(repository, environment)))]
  const builds = [...built, Math.min(...built) - 1].sort((a, b) => b - a)
  return {
    workflow_runs: builds.map((build, index) => ({
      head_sha: commitOf(repository, build),
      display_title: changeOf(repository, build),
      status: "completed",
      conclusion: "success",
      updated_at: new Date(Date.now() - (30 + index * 190) * 60_000).toISOString(),
      html_url: `https://github.com/larder/${repository}/actions/runs/${build}`,
    })),
  }
}

/** The world for this catalog: a handler that answers each tool's requests, and logs what it does not know. */
export const worldFor = (catalog: Catalog, unknown: (path: string) => void = () => undefined) => {
  const silences = new Map<string, Silence>()
  const silencedBy = (labels: Record<string, string>) =>
    [...silences.values()]
      .filter((silence) => silence.matchers.every((m) => labels[m.name] === m.value))
      .map((s) => s.id)
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === "/healthz") return new Response("ok")
    if (url.pathname === "/v1/chat/completions") return modelAnswer(request)
    const repository = /^\/repos\/larder\/([\w-]+)\/actions\/workflows\/[\w.-]+\/runs$/.exec(url.pathname)?.[1]
    if (repository !== undefined) return json(runsOf(repository))
    const environment = environments.find((each) => url.pathname.startsWith(`/${each}/`))
    if (environment === undefined) {
      unknown(url.pathname)
      return json({ message: "Not Found" }, 404)
    }
    const path = url.pathname.slice(environment.length + 1)
    const inner = new URL(`${path}${url.search}`, url.origin)
    if (path === "/api/v1/query") return json(instantOf(environment, url.searchParams.get("query") ?? ""))
    if (path === "/api/v1/query_range") return json(rangeOf(environment, url))
    if (path === "/api/v1/rules")
      return json({ status: "success", data: { groups: [{ rules: rulesIn(environment) }] } })
    if (path === "/api/v1/alerts") return json({ status: "success", data: { alerts: [] } })
    if (path === "/api/v2/alerts")
      return json(
        firingIn(environment).map((alert) => ({
          ...alert,
          status: {
            state: silencedBy(alert.labels).length > 0 ? "suppressed" : "active",
            silencedBy: silencedBy(alert.labels),
            inhibitedBy: [],
          },
        })),
      )
    if (path === "/api/v2/silences" && request.method === "GET")
      return json([...silences.values()].map((silence) => ({ ...silence, status: { state: "active" } })))
    if (path === "/api/v2/silences" && request.method === "POST") {
      const id = crypto.randomUUID()
      silences.set(id, { id, matchers: [], ...((await request.json()) as object) })
      return json({ silenceID: id })
    }
    if (path.startsWith("/api/v2/silence/") && request.method === "DELETE") {
      silences.delete(path.slice("/api/v2/silence/".length))
      return json({})
    }
    const traced = tempoAnswer(environment, inner)
    if (traced !== undefined) return json(traced)
    const kube = kubeAnswer(catalog, environment, inner)
    if (typeof kube === "string") return new Response(kube)
    if (kube !== undefined) return json(kube)
    unknown(url.pathname)
    return json({ message: "Not Found" }, 404)
  }
}

if (import.meta.main) {
  const catalog = Bun.YAML.parse(await Bun.file(new URL("catalog.yaml", import.meta.url)).text()) as Catalog
  const port = Number(process.env["WORLD_PORT"] ?? 8484)
  const fetch = worldFor(catalog, (path) => process.stderr.write(`world: no answer for ${path}\n`))
  Bun.serve({ port, hostname: "127.0.0.1", fetch })
  process.stdout.write(`world on ${port}\n`)
}
