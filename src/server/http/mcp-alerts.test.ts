import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, catalog, environment, estate, type Server, serverFor, settings } from "../fixture"
import { type Call, reply } from "../remote"
import type { Settings } from "../settings"

const viewer = "mcp-test-token-for-viewer-agents-x"
const operator = "mcp-test-token-for-operator-agents"
const withMcp = (extra: Partial<Settings> = {}): Settings => ({
  ...settings({ anonymous: { name: "gil", role: "viewer" }, logs: "operator" }),
  sources: { staging: {}, production: { loki: { url: "http://loki" } } },
  mcp: {
    tokens: [
      { name: "claude-code", token: Redacted.make(viewer), role: "viewer" },
      { name: "on-call-bot", token: Redacted.make(operator), role: "operator" },
    ],
  },
  ...extra,
})

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const fired = estate({
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
    }),
  },
  firings: [
    {
      environment: "production",
      alert: "a1",
      name: "OrdersSlow",
      startsAt: "2026-09-27T09:10:00Z",
      endsAt: "2026-09-27T09:32:00Z",
      silence: { by: "gil", reason: "provider outage" },
    },
  ],
  notes: [
    { id: "n1", environment: "production", alert: "a1", at: "2026-09-27T09:20:00Z", by: "ada", text: "vacuumed it" },
  ],
})

const loki = (call: Call) =>
  call.url.startsWith("http://loki/")
    ? reply({
        status: "success",
        data: {
          resultType: "streams",
          result: [
            { stream: { pod: "orders-1" }, values: [[`${Date.now() - 1000}000000`, "ERROR lock timeout on 7"]] },
          ],
        },
      })
    : undefined

const headers = (token: string, session?: string): Record<string, string> => ({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: `Bearer ${token}`,
  ...(session === undefined ? {} : { "mcp-session-id": session }),
})
const post = (body: unknown, sent: Record<string, string>) =>
  new Request("http://estate/mcp", { method: "POST", headers: sent, body: JSON.stringify(body) })

/** The JSON-RPC answer in a reply, whether sent as JSON or as an event stream. */
const answerIn = (text: string): { result?: unknown } =>
  JSON.parse(
    text
      .split("\n")
      .find((line) => line.startsWith("data: "))
      ?.slice(6) ?? text,
  )

/** Calls one tool as the agent holding `token`, after the handshake MCP asks for. */
const call = (server: Server, token: string, name: string, args: Record<string, unknown>) =>
  Effect.gen(function* () {
    const init = yield* ask(
      server,
      post(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
        },
        headers(token),
      ),
    )
    const session = headers(token, init.headers.get("mcp-session-id") ?? undefined)
    yield* ask(server, post({ jsonrpc: "2.0", method: "notifications/initialized" }, session))
    const called = yield* ask(
      server,
      post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }, session),
    )
    const result = answerIn(called.text).result as {
      isError?: boolean
      structuredContent?: Record<string, unknown>
      content?: ReadonlyArray<{ text?: string }>
    }
    return {
      isError: result.isError === true,
      body: result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "{}"),
    }
  })

describe("/mcp's tools about what is happening", () => {
  test("give an alert's earlier firings with who silenced each and the notes written then", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withMcp(), fired, loki)
        return yield* call(server, viewer, "alert_history", { alert: "OrdersSlow", environment: "production" })
      }),
    ).then(({ isError, body }) => {
      expect(isError).toBe(false)
      expect(body).toEqual({
        summary: "OrdersSlow fired 1 time before; last 2026-09-27T09:10:00Z.",
        environment: "production",
        name: "OrdersSlow",
        firings: [
          {
            startsAt: "2026-09-27T09:10:00Z",
            endsAt: "2026-09-27T09:32:00Z",
            silence: { by: "gil", reason: "provider outage" },
            notes: [{ at: "2026-09-27T09:20:00Z", by: "ada", text: "vacuumed it" }],
          },
        ],
      })
    }))

  test("list the alerts, today's changes, the agents and what is around an alert", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withMcp(), fired, loki)
        return [
          yield* call(server, viewer, "alerts", {}),
          yield* call(server, viewer, "changes", { environment: "production" }),
          yield* call(server, viewer, "agents", {}),
          yield* call(server, viewer, "around_alert", { alert: "a1", environment: "production" }),
          yield* call(server, viewer, "alert_history", { alert: "Nothing", environment: "production" }),
          yield* call(server, viewer, "alerts", { environment: "production" }),
          yield* call(server, viewer, "around_alert", { alert: "Nothing", environment: "production" }),
        ]
      }),
    ).then(([alerts, changes, agents, around, missing, firing, nowhere]) => {
      expect(firing?.body.summary).toBe("1 alert firing in production: OrdersSlow.")
      expect(nowhere?.isError).toBe(true)
      expect(alerts?.body.summary).toBe("Nothing is firing in staging.")
      expect(changes?.body.environment).toBe("production")
      expect(agents?.body.summary).toBe("0 agents in staging, none needing someone.")
      const brief = around?.body["around"] as { name: string; errors?: unknown } | undefined
      expect(brief?.name).toBe("OrdersSlow")
      // The viewer's token may not read logs here, so the brief carries none.
      expect(brief?.errors).toBeUndefined()
      expect(missing?.isError).toBe(true)
    }))

  test("read a service's errors for an agent whose role may read logs, and refuse one whose role may not", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withMcp(), fired, loki)
        return [
          yield* call(server, operator, "errors", { service: "orders", environment: "production" }),
          yield* call(server, viewer, "errors", { service: "orders", environment: "production" }),
          yield* call(server, operator, "errors", { service: "ghost", environment: "production" }),
        ]
      }),
    ).then(([read, refused, none]) => {
      expect(read?.isError).toBe(false)
      expect(read?.body.summary).toBe('1 kind of error from orders in the last 1h; most: "ERROR lock timeout on ‹n›".')
      expect(refused?.isError).toBe(true)
      expect(none?.isError).toBe(true)
    }))
})
