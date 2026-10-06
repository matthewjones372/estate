/**
 * `/mcp` as an agent meets it: the MCP SDK's own client, over streamable HTTP, against the example estate. No browser:
 * this is what Claude Code or any MCP client does when given Estate's URL and a token.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { expect, test } from "@playwright/test"

const token = "e2e-agent-token-of-at-least-32-chars"

const connected = async () => {
  const client = new Client({ name: "e2e", version: "0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8181/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

/** What a tool answered, as the structured content it sent. */
const answered = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: { environment: "production", ...args } })
  expect(result.isError ?? false, `${name} failed: ${JSON.stringify(result.content)}`).toBe(false)
  return result.structuredContent as { summary: string }
}

test("an agent lists Estate's tools and calls each one", async () => {
  const client = await connected()
  const { tools } = await client.listTools()
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "agents",
    "alert_history",
    "alerts",
    "around_alert",
    "changes",
    "errors",
    "estate_now",
    "service",
    "services",
  ])
  expect((await answered(client, "estate_now", {})).summary).not.toBe("")
  expect((await answered(client, "services", {})).summary).toMatch(/in production/)
  expect((await answered(client, "service", { name: "orders" })).summary).toMatch(/^orders is /)
  expect((await answered(client, "alerts", {})).summary).toContain("OrdersSlow")
  expect((await answered(client, "alert_history", { alert: "SearchIndexStale" })).summary).toContain(
    "SearchIndexStale fired 1 time before",
  )
  expect((await answered(client, "changes", {})).summary).toMatch(/changes? in production today/)
  expect((await answered(client, "errors", { service: "orders" })).summary).toContain("payment provider timed out")
  expect((await answered(client, "agents", {})).summary).not.toBe("")
  const around = (await answered(client, "around_alert", { alert: "OrdersSlow" })) as {
    around: { runbook?: { text?: string } }
  }
  expect(around.around.runbook?.text).toContain("If p99 is high after a deploy, roll back.")
  await client.close()
})

test("an agent without a token is turned away", async () => {
  const client = new Client({ name: "e2e", version: "0" })
  await expect(
    client.connect(new StreamableHTTPClientTransport(new URL("http://127.0.0.1:8181/mcp"))),
  ).rejects.toThrow()
})
