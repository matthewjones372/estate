/**
 * A fake Datadog, for the cloud estate's Datadog environment: a monitor alerting for payments, downtimes kept as they
 * are written and cancelled, timeseries for any query, and payments' lines. Every call needs both keys.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status })

const downtimes = new Map<string, { id: string; attributes: Record<string, unknown> }>()

const monitor = {
  id: 7,
  name: "Payments are slow",
  message: "{{#is_alert}}Payments are slower than customers wait for{{/is_alert}} @slack-payments",
  tags: ["team:payments"],
  query: "avg(last_5m):p99:trace.http.request{service:payments} > 0.8",
  overall_state: "Alert",
  state: { groups: { "env:production,service:payments": { status: "Alert", last_triggered_ts: 1_791_028_800 } } },
}

const timeseries = async (request: Request) => {
  const { attributes } = (await request.json()).data
  const times: Array<number> = []
  for (let at = attributes.from; at <= attributes.to; at += attributes.interval) times.push(at)
  return json({
    data: {
      attributes: {
        series: attributes.queries.map((_: unknown, index: number) => ({ query_index: index, group_tags: [] })),
        times,
        values: attributes.queries.map((_: unknown, index: number) =>
          times.map((time) => 0.9 + 0.1 * Math.sin(time / 600_000 + index)),
        ),
      },
    },
  })
}

const lines = () => {
  const now = Date.now()
  return json({
    data: [
      {
        attributes: {
          timestamp: new Date(now - 5000).toISOString(),
          message: "card 4111111111111111 declined by the provider",
          status: "error",
          attributes: { pod_name: "payments-5d8-xk2" },
        },
      },
      { attributes: { timestamp: new Date(now - 20_000).toISOString(), message: "payment taken", status: "info" } },
    ],
  })
}

export const datadog = async (request: Request, path: string): Promise<Response> => {
  if (request.headers.get("dd-api-key") !== "e2e-api" || request.headers.get("dd-application-key") !== "e2e-app")
    return json({ errors: ["Forbidden"] }, 403)
  const url = new URL(request.url)
  if (path === "/api/v1/monitor") return json(url.searchParams.get("page") === "0" ? [monitor] : [])
  if (path === "/api/v2/downtime" && request.method === "POST") {
    const id = `dt-${downtimes.size + 1}`
    const { attributes } = (await request.json()).data
    downtimes.set(id, { id, attributes: { ...attributes, status: "active" } })
    return json({ data: { id } })
  }
  if (path === "/api/v2/downtime") return json({ data: [...downtimes.values()] })
  if (path.startsWith("/api/v2/downtime/") && request.method === "DELETE") {
    downtimes.delete(path.split("/").at(-1) ?? "")
    return new Response(null, { status: 204 })
  }
  if (path === "/api/v2/query/timeseries") return timeseries(request)
  if (path === "/api/v2/logs/events/search") return lines()
  return json({ errors: ["Not found"] }, 404)
}
