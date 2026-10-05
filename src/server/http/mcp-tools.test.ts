import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import type { Settings } from "../settings"

const token = "mcp-test-token-for-viewer-agents"
const withMcp = (): Settings => ({
  ...settings({ anonymous: { name: "gil", role: "viewer" } }),
  mcp: { tokens: [{ name: "claude-code", token: Redacted.make(token), role: "viewer" }] },
})
const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const mcpHeaders = (bearer: string, session?: string) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${bearer}`,
  }
  if (session !== undefined) headers["mcp-session-id"] = session
  return headers
}
const rpc = (method: string, params?: unknown, id: number = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })
const post = (body: string, headers: Record<string, string>) =>
  new Request("http://estate/mcp", { method: "POST", headers, body })
const mcpResult = (text: string) => JSON.parse(text) as { result?: unknown }
const toolPayload = (result: unknown): Record<string, unknown> => {
  const body = result as {
    structuredContent?: Record<string, unknown>
    content?: ReadonlyArray<{ type: string; text?: string }>
  }
  if (body.structuredContent !== undefined) return body.structuredContent
  return JSON.parse(body.content?.find((each) => each.type === "text")?.text ?? "{}") as Record<string, unknown>
}

const openSession = (server: Effect.Success<ReturnType<typeof serverFor>>) =>
  Effect.gen(function* () {
    const init = yield* ask(
      server,
      post(
        rpc("initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        }),
        mcpHeaders(token),
      ),
    )
    const headers = mcpHeaders(token, init.headers.get("mcp-session-id") ?? undefined)
    yield* ask(server, post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), headers))
    return headers
  })

describe("MCP tools beyond estate_now", () => {
  test("answers one service's health, pods, alerts and links", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(
          withMcp(),
          estate({
            catalog: {
              ...catalog,
              services: catalog.services.map((each) =>
                each.name === "orders"
                  ? {
                      ...each,
                      owner: "payments",
                      category: "Checkout",
                      links: { docs: "https://docs.example/{service}" },
                    }
                  : each,
              ),
              teams: [{ name: "payments", title: "Payments", links: { slack: "https://slack.example/payments" } }],
            },
            environments: {
              staging: environment(),
              production: environment({
                alerts: ok([
                  {
                    id: "a1",
                    name: "OrdersSlow",
                    state: "firing",
                    severity: "warning",
                    startsAt: "2026-10-03T11:46:00Z",
                    labels: { service: "orders" },
                    summary: "Orders are slow",
                  },
                ]),
                cluster: ok({
                  pods: {
                    orders: [{ name: "orders-1", phase: "Running", ready: true, restarts: 0, image: "orders:v2" }],
                  },
                  debug: {},
                }),
                deploys: ok({ orders: { version: "v2", ready: true, at: "2026-10-03T11:20:00Z" } }),
              }),
            },
          }),
        )
        const headers = yield* openSession(server)
        const called = yield* ask(
          server,
          post(
            rpc("tools/call", { name: "service", arguments: { name: "orders", environment: "production" } }, 2),
            headers,
          ),
        )
        const payload = toolPayload(mcpResult(called.text).result) as {
          name: string
          health: string
          pods: ReadonlyArray<unknown>
          alerts: ReadonlyArray<{ name: string }>
          links: ReadonlyArray<{ name: string }>
          team: { name: string }
          summary: string
        }
        expect(payload.name).toBe("orders")
        expect(payload.health).toBe("attention")
        expect(payload.pods).toHaveLength(1)
        expect(payload.alerts.some((each) => each.name === "OrdersSlow")).toBe(true)
        expect(payload.links.some((each) => each.name === "docs")).toBe(true)
        expect(payload.team.name).toBe("payments")
        expect(payload.summary).toContain("orders")
        const missing = yield* ask(
          server,
          post(
            rpc("tools/call", { name: "service", arguments: { name: "nope", environment: "production" } }, 3),
            headers,
          ),
        )
        expect((mcpResult(missing.text).result as { isError?: boolean }).isError).toBe(true)
      }),
    ))

  test("lists stores, jobs and agents beside services", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(
          withMcp(),
          estate({
            catalog: {
              ...catalog,
              stores: [{ name: "cache", environments: ["staging"], engine: "redis", selector: 'i="cache"' }],
              jobs: [
                {
                  name: "reindex",
                  environments: ["staging"],
                  run: { kubernetes: { namespace: "jobs", cronJob: "reindex" } },
                },
              ],
              agents: [{ name: "scribe", environments: ["staging"], budget: { tokens: 100, per: "day" } }],
            },
            environments: {
              staging: environment({
                alerts: ok([]),
                cluster: ok({
                  pods: {},
                  debug: {},
                  jobs: {
                    reindex: [{ name: "reindex", kind: "CronJob", suspended: false, schedule: "0 0 * * *", runs: [] }],
                  },
                }),
                metrics: ok({
                  services: {},
                  stores: { cache: [{ key: "hit", title: "Hit", series: { now: 1, points: [1] } }] },
                  vitals: [],
                  edges: [],
                  charts: {},
                  agents: { scribe: { spent: 1, model: "m" } },
                }),
              }),
              production: environment(),
            },
          }),
        )
        const headers = yield* openSession(server)
        const called = yield* ask(
          server,
          post(rpc("tools/call", { name: "services", arguments: { environment: "staging" } }, 2), headers),
        )
        const payload = toolPayload(mcpResult(called.text).result) as {
          items: ReadonlyArray<{ name: string; kind: string }>
        }
        const kinds = new Set(payload.items.map((each) => each.kind))
        expect(kinds.has("store")).toBe(true)
        expect(kinds.has("job")).toBe(true)
        expect(kinds.has("agent")).toBe(true)
      }),
    ))
})
