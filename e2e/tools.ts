/**
 * A small estate's tools on one port, answering in their own shapes, for the pages' tests and screenshots:
 * Prometheus (with the stores' exporters' series), Alertmanager (silences kept), a Kubernetes API with Flux (ConfigMaps patched, pods logging), and GitHub
 * Actions.
 */
import { kube } from "./cluster"

const now = () => Math.floor(Date.now() / 1000)
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const wave = (base: number, swing: number, phase: number) => (at: number) => base + swing * Math.sin(at / 600 + phase)

const series: Array<[RegExp, (at: number) => number]> = [
  // The support agent, in OpenTelemetry's GenAI metrics: a run every few seconds, a few failing, within its budget.
  [/increase\(gen_ai_client_token_usage_sum/, () => 6_100_000],
  [/gen_ai_client_token_usage_sum/, wave(420_000, 60_000, 3)],
  [/^histogram_quantile.*gen_ai_client_operation_duration/, wave(14, 3, 4)],
  [/gen_ai_client_operation_duration_seconds_count.*error_type/, wave(0.004, 0.002, 5)],
  [/gen_ai_client_operation_duration_seconds_count/, wave(0.3, 0.05, 6)],
  // The stores' exporters: postgres_exporter, redis_exporter and kafka_exporter, every store well.
  [/pg_stat_activity_count/, wave(38, 6, 1)],
  [/pg_stat_database_xact_commit/, wave(120, 25, 2)],
  [/pg_replication_lag_seconds/, wave(0.4, 0.2, 3)],
  [/pg_database_size_bytes/, wave(2.1 * 1024 ** 3, 0.01 * 1024 ** 3, 4)],
  [/pg_stat_database_deadlocks/, () => 0],
  [/redis_memory_used_bytes/, wave(62, 4, 5)],
  [/redis_keyspace_hits_total/, wave(94, 2, 6)],
  [/redis_evicted_keys_total/, () => 0],
  [/redis_connected_clients/, wave(18, 3, 7)],
  [/^deriv\(sum\(kafka_consumergroup_lag/, () => 0],
  [/kafka_consumergroup_lag/, wave(35, 20, 8)],
  [/kafka_topic_partition_current_offset/, wave(240, 40, 9)],
  [/kafka_topic_partition_under_replicated_partition/, () => 0],
  [/^histogram_quantile.*app="orders"/, (at) => 0.06 + 0.16 * Math.max(0, (at - (now() - 1500)) / 1500)],
  [/^histogram_quantile/, wave(0.045, 0.01, 1)],
  [/code=~"5\.\."|outcome="error"/, wave(0.02, 0.02, 2)],
  [/payments_total/, wave(9, 2, 4)],
  [/search_requests_total/, wave(64, 9, 5)],
  [/orders_placed_total\[5m\]/, wave(3.4, 0.6, 6)],
  [/baskets_created_total/, wave(31, 3, 7)],
  [/jvm_memory_used_bytes/, wave(420 * 1024 ** 2, 60 * 1024 ** 2, 8)],
  [/jvm_gc_pause/, wave(0.012, 0.004, 9)],
  [/jvm_threads/, wave(64, 4, 10)],
  [/process_cpu_usage/, wave(23, 8, 11)],
  [/container_cpu/, wave(0.4, 0.1, 12)],
  [/container_memory/, wave(310 * 1024 ** 2, 20 * 1024 ** 2, 13)],
  [/orders_waiting/, wave(12, 5, 14)],
  [/app="storefront"/, wave(118, 14, 0)],
  [/app="orders"/, wave(42, 6, 3)],
]

/** A pod's latest lines, with the timestamps the cluster puts in front: a few each read, now and then an error. */
let logged = 0
const podLog = (pod: string) => {
  logged += 1
  const at = (back: number) => new Date(Date.now() - back).toISOString()
  return [
    `${at(1500)} INFO served /products in ${10 + (logged % 7)} ms`,
    `${at(1000)} INFO basket ${4000 + logged} updated`,
    ...(logged % 3 === 0 || pod.endsWith("-a")
      ? [`${at(500)} ERROR payment provider timed out after 3000 ms for order ${logged}`]
      : []),
  ]
    .map((line) => `${line}\n`)
    .join("")
}

/** SearchIndexStale fired for twenty minutes six days ago, as Prometheus's ALERTS series keeps it. */
const earlierFirings = (end: number, step: number) => {
  const from = Math.floor((end - 6 * 86_400) / step) * step
  const values: Array<[number, string]> = []
  for (let at = from; at < from + 20 * 60; at += step) values.push([at, "1"])
  const metric = {
    __name__: "ALERTS",
    alertstate: "firing",
    alertname: "SearchIndexStale",
    severity: "warning",
    app: "search",
  }
  return { status: "success", data: { resultType: "matrix", result: [{ metric, values }] } }
}

const traceOf = (id: string) => ({
  id,
  timestamp: new Date(now() - (id === "t2" ? 2 : 5) * 60_000).toISOString(),
  htmlPath: `/project/shop/traces/${id}`,
  latency: id === "t2" ? 31.2 : 9.4,
  totalCost: id === "t2" ? 0.041 : 0.012,
  observations: [
    { type: "GENERATION", level: "DEFAULT", model: "claude-sonnet", usage: { total: id === "t2" ? 10_400 : 4_100 } },
    ...(id === "t2" ? [{ type: "SPAN", level: "ERROR", statusMessage: "tool search_orders timed out" }] : []),
  ],
})

const queryRange = (url: URL) => {
  const query = url.searchParams.get("query") ?? ""
  const start = Number(url.searchParams.get("start"))
  const end = Number(url.searchParams.get("end"))
  const step = Number(url.searchParams.get("step"))
  if (query.startsWith("ALERTS{")) return earlierFirings(end, step)
  const value = series.find(([pattern]) => pattern.test(query))?.[1]
  if (value === undefined) return { status: "success", data: { resultType: "matrix", result: [] } }
  const values: Array<[number, string]> = []
  for (let at = start; at <= end; at += step) values.push([at, String(value(at))])
  return { status: "success", data: { resultType: "matrix", result: [{ metric: { app: "orders" }, values }] } }
}

const silences = new Map<
  string,
  {
    id: string
    createdBy: string
    comment: string
    startsAt: string
    endsAt: string
    matchers: Array<{ name: string; value: string }>
  }
>()

const port = Number(process.env["TOOLS_PORT"] ?? 8282)
const here = `http://127.0.0.1:${port}`

/** OrdersSlow's runbook, kept as Markdown in the repository it names. */
const runbook = `# Orders are slow

If p99 is high after a deploy, roll back. If the database is the cause, check for long-running vacuums.
`

/** A self-hosted model behind the OpenAI-compatible API, answering from the brief it was sent. */
const modelAnswer = async (request: Request) => {
  const body = await request.json()
  const brief: string = body.messages?.at(-1)?.content ?? ""
  const answer = {
    likelyCause: brief.includes("stalled")
      ? "orders' new version never rolled out: its image policy cannot list tags."
      : "Nothing in the brief explains it.",
    evidence: [{ text: brief.split("\n").find((line) => line.includes("stalled")) ?? "no change near it" }],
    nextSteps: ["Fix the registry credentials Flux uses for orders"],
    confidence: "medium",
  }
  return json({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { total_tokens: 1200 } })
}

const firing = [
  {
    labels: { alertname: "OrdersSlow", severity: "warning", app: "orders" },
    annotations: { summary: "Orders are slow to place", runbook_url: `${here}/runbooks/orders-slow.md` },
    startsAt: minutesAgo(14),
  },
  {
    labels: { alertname: "SearchIndexStale", severity: "warning", app: "search" },
    annotations: {
      summary: "Search has not indexed for 40 minutes",
      impact: "New products can't be found in search; existing ones still can.",
    },
    startsAt: minutesAgo(41),
  },
]

const silencedBy = (labels: Record<string, string>) =>
  [...silences.values()]
    .filter((silence) => silence.matchers.every((matcher) => labels[matcher.name] === matcher.value))
    .map((silence) => silence.id)

const configMaps = new Map<
  string,
  { metadata: { name: string; annotations: Record<string, string> }; data: Record<string, string> }
>([["storefront-logging", { metadata: { name: "storefront-logging", annotations: {} }, data: { level: "INFO" } }]])

const run = (
  sha: string,
  title: string,
  minutes: number,
  status = "completed",
  conclusion: string | null = "success",
) => ({
  head_sha: sha,
  display_title: title,
  status,
  conclusion,
  updated_at: minutesAgo(minutes),
  html_url: `https://github.com/example/runs/${sha}`,
})

const json = (body: unknown, status = 200) => Response.json(body, { status })

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const url = new URL(request.url)
    const path = url.pathname
    if (path === "/api/v1/query_range") return json(queryRange(url))
    if (path === "/runbooks/orders-slow.md")
      return new Response(runbook, { headers: { "content-type": "text/markdown" } })
    if (path === "/v1/chat/completions") return modelAnswer(request)
    // Langfuse's traces of the support agent: one failed on a tool, one through.
    if (path === "/api/public/traces") return json({ data: [{ id: "t2" }, { id: "t1" }], meta: { page: 1 } })
    if (path.startsWith("/api/public/traces/")) return json(traceOf(path.split("/").at(-1) ?? ""))
    // The model the support agent uses, as the label of the series its query groups by.
    if (path === "/api/v1/query")
      return json({
        status: "success",
        data: {
          resultType: "vector",
          result: [{ metric: { gen_ai_response_model: "claude-sonnet" }, value: [0, "1"] }],
        },
      })
    if (path === "/api/v1/rules")
      return json({
        status: "success",
        data: {
          groups: [
            {
              rules: [
                {
                  type: "alerting",
                  name: "OrdersSlow",
                  query:
                    'histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket{app="orders"}[5m]))) > 0.15',
                },
              ],
            },
          ],
        },
      })
    if (path === "/api/v1/alerts")
      return json({
        status: "success",
        data: {
          alerts: [
            {
              labels: { alertname: "PaymentsRetrying", severity: "warning", app: "payments" },
              annotations: { summary: "Payments are being retried" },
              state: "pending",
              activeAt: minutesAgo(2),
            },
          ],
        },
      })
    if (path === "/api/v2/alerts") {
      return json(
        firing.map((alert) => ({
          ...alert,
          status: {
            state: silencedBy(alert.labels).length > 0 ? "suppressed" : "active",
            silencedBy: silencedBy(alert.labels),
            inhibitedBy: [],
          },
        })),
      )
    }
    if (path === "/api/v2/silences" && request.method === "GET")
      return json([...silences.values()].map((silence) => ({ ...silence, status: { state: "active" } })))
    if (path === "/api/v2/silences" && request.method === "POST") {
      const body = await request.json()
      const id = crypto.randomUUID()
      silences.set(id, { id, ...body })
      return json({ silenceID: id })
    }
    if (path.startsWith("/api/v2/silence/") && request.method === "DELETE") {
      silences.delete(path.slice("/api/v2/silence/".length))
      return json({})
    }
    const logging = /^\/api\/v1\/namespaces\/[\w-]+\/pods\/([\w-]+)\/log$/.exec(path)?.[1]
    if (logging !== undefined) return new Response(podLog(logging))
    const map = /^\/api\/v1\/namespaces\/shop\/configmaps\/([\w-]+)$/.exec(path)?.[1]
    if (map !== undefined) {
      const found = configMaps.get(map)
      if (found === undefined) return json({ message: "not found" }, 404)
      if (request.method === "PATCH") {
        const patch = await request.json()
        for (const [name, value] of Object.entries(patch.metadata?.annotations ?? {})) {
          if (value === null) delete found.metadata.annotations[name]
          else found.metadata.annotations[name] = String(value)
        }
        Object.assign(found.data, patch.data ?? {})
      }
      return json(found)
    }
    const answer = kube[`${path}${url.search}`]
    if (answer !== undefined) return json(answer())
    const repository = /^\/repos\/example\/([\w-]+)\/actions\/workflows\/build\.yml\/runs$/.exec(path)?.[1]
    if (repository === "storefront")
      return json({
        workflow_runs: [run("c556728aa", "Faster product pages", 52), run("9a1b2c3dd", "Basket badge", 300)],
      })
    if (repository === "orders")
      return json({
        workflow_runs: [
          run("04bc441ee", "Split shipments", 9, "in_progress", null),
          run("3889c5cff", "Retry payment once", 75),
        ],
      })
    return json({ message: "Not Found" }, 404)
  },
})

process.stdout.write(`tools on ${server.port}\n`)
