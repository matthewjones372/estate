import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import type { Settings } from "../settings"

const token = "mcp-test-token-for-viewer-agents"
const withMcp = (extra: Partial<Settings> = {}): Settings => ({
  ...settings({ anonymous: { name: "gil", role: "viewer" } }),
  mcp: { tokens: [{ name: "claude-code", token: Redacted.make(token), role: "viewer" }] },
  ...extra,
})

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const troubled = estate({
  catalog,
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
          orders: [
            { name: "orders-1", phase: "Running", ready: true, restarts: 0, image: "orders:v2" },
            { name: "orders-2", phase: "Running", ready: false, restarts: 1, image: "orders:v2" },
          ],
          storefront: [{ name: "sf-1", phase: "Running", ready: true, restarts: 0, image: "sf:v1" }],
        },
        debug: {},
      }),
    }),
  },
})

const mcpHeaders = (bearer: string | undefined, session?: string) => {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  }
  if (bearer !== undefined) headers["authorization"] = `Bearer ${bearer}`
  if (session !== undefined) headers["mcp-session-id"] = session
  return headers
}

const rpc = (method: string, params?: unknown, id: number | string = 1) =>
  JSON.stringify({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })

const post = (body: string, headers: Record<string, string>) =>
  new Request("http://estate/mcp", { method: "POST", headers, body })

const mcpResult = (text: string, contentType: string | null): { result?: unknown; error?: unknown } => {
  if (contentType?.includes("text/event-stream") === true) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue
      const parsed = JSON.parse(line.slice(6)) as { result?: unknown; error?: unknown }
      if (parsed.result !== undefined || parsed.error !== undefined) return parsed
    }
  }
  return JSON.parse(text) as { result?: unknown; error?: unknown }
}

const toolPayload = (result: unknown): Record<string, unknown> => {
  const body = result as {
    structuredContent?: Record<string, unknown>
    content?: ReadonlyArray<{ type: string; text?: string }>
  }
  if (body.structuredContent !== undefined) return body.structuredContent
  const text = body.content?.find((each) => each.type === "text")?.text
  if (text === undefined) return {}
  return JSON.parse(text) as Record<string, unknown>
}

describe("/mcp", () => {
  test("answers 401 without a matching bearer token, and when mcp is not configured", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const configured = yield* serverFor(withMcp(), troubled)
        const bare = yield* serverFor(settings({ anonymous: { name: "gil", role: "viewer" } }), troubled)
        const body = rpc("initialize", {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        })
        return [
          (yield* ask(configured, post(body, mcpHeaders(undefined)))).status,
          (yield* ask(configured, post(body, mcpHeaders("wrong")))).status,
          (yield* ask(bare, post(body, mcpHeaders(token)))).status,
        ]
      }),
    ).then((statuses) => expect(statuses).toEqual([401, 401, 401])))

  test("lists its tools and answers what needs someone in production", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withMcp(), troubled)
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
        expect(init.status).toBe(200)
        const session = init.headers.get("mcp-session-id")
        expect(session).toBeTruthy()
        const headers = mcpHeaders(token, session ?? undefined)
        yield* ask(server, post(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), headers))
        const listed = yield* ask(server, post(rpc("tools/list", {}, 2), headers))
        expect(listed.status).toBe(200)
        const listBody = mcpResult(listed.text, listed.headers.get("content-type"))
        const tools = (listBody.result as { tools: ReadonlyArray<{ name: string }> }).tools
        expect(tools.map((each) => each.name).sort()).toEqual(["estate_now", "service", "services"])
        const called = yield* ask(
          server,
          post(rpc("tools/call", { name: "estate_now", arguments: { environment: "production" } }, 3), headers),
        )
        expect(called.status).toBe(200)
        const now = toolPayload(mcpResult(called.text, called.headers.get("content-type")).result) as {
          summary: string
          needs: ReadonlyArray<{ name: string }>
          lede: string
        }
        expect(now.summary).toMatch(/needs you|need you/)
        expect(now.lede).toContain("orders:")
        expect(now.needs.some((each) => each.name === "orders")).toBe(true)
      }),
    ))

  test("still serves reads when Estate is read-only", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withMcp({ readOnly: true }), troubled)
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
        const called = yield* ask(
          server,
          post(rpc("tools/call", { name: "services", arguments: { environment: "production" } }, 2), headers),
        )
        const payload = toolPayload(mcpResult(called.text, called.headers.get("content-type")).result) as {
          items: ReadonlyArray<{ name: string }>
        }
        expect(payload.items.some((each) => each.name === "orders")).toBe(true)
      }),
    ))
})
