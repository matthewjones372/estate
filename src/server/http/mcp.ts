/** `/mcp` over streamable HTTP: Effect's McpServer with Estate's read tools, gated by bearer tokens. */
import { Layer } from "effect"
import { McpProtocol, McpServer } from "effect/ai"
import { estateVersion } from "../version"
import { alertHandlers, alertToolkit } from "./mcp-alerts"
import { mcpAuth } from "./mcp-auth"
import { mcpHandlers, mcpToolkit } from "./mcp-tools"

const server = McpServer.layerHttp({
  name: "estate",
  version: estateVersion,
  description: "Ask Estate: the same estate a person sees on the page.",
  path: "/mcp",
  protocols: [McpProtocol.v2025_03_26, McpProtocol.v2025_06_18, McpProtocol.v2025_11_25],
}).pipe(Layer.provide(mcpAuth.layer))

const tools = McpServer.toolkit(mcpToolkit).pipe(Layer.provide(mcpHandlers))
const alertTools = McpServer.toolkit(alertToolkit).pipe(Layer.provide(alertHandlers))

/** The `/mcp` route and its tools; auth middleware refuses requests without a matching token. */
export const mcpRoute = Layer.mergeAll(server, tools, alertTools)
