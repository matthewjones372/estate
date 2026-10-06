/**
 * The read tools Ask AI's model may call: the same handlers `/mcp` serves, run as the person asking, so the model
 * reads what that person could read on the page and nothing more. Each answer goes back to the model as JSON text.
 */
import { Effect, Layer, Stream } from "effect"
import { Tool, Toolkit } from "effect/ai"
import type { Tools } from "../model"
import type { ToolCall } from "../model-apis"
import { alertHandlers, alertToolkit } from "./mcp-alerts"
import { McpCaller } from "./mcp-shared"
import { mcpHandlers, mcpToolkit } from "./mcp-tools"

const toolkit = Toolkit.merge(mcpToolkit, alertToolkit)
const handlers = Layer.merge(mcpHandlers, alertHandlers)

/** The tools offered: what the brief may not already say. `around_alert` is the brief itself. */
const offered = ["service", "changes", "alert_history", "errors", "alerts"] as const
type Offered = (typeof offered)[number]

const isOffered = (name: string): name is Offered => offered.some((each) => each === name)

const offers = offered.map((name) => {
  const tool = toolkit.tools[name]
  return { name, description: Tool.getDescription(tool) ?? name, schema: Tool.getJsonSchema(tool) }
})

/** The input as the model gave it, about `environment` unless it named another. */
const inEnvironment = (input: unknown, environment: string): unknown =>
  typeof input === "object" && input !== null && !Array.isArray(input) ? { environment, ...input } : input

/** The read tools, run as `asker` about the alert's `environment`, for one ask. */
export const askTools = (asker: McpCaller, environment: string) =>
  Effect.map(Effect.provide(toolkit, handlers), (kit): Tools => {
    const run = (call: ToolCall): Effect.Effect<string> => {
      if (!isOffered(call.name)) return Effect.succeed(`there is no tool ${call.name}`)
      // `handle` decodes the parameters against the tool's own schema, so the model's input needs no shape here.
      return kit.handle(call.name, inEnvironment(call.input, environment) as never).pipe(
        Effect.flatMap(Stream.runLast),
        Effect.provideService(McpCaller, asker),
        Effect.result,
        Effect.map((read) =>
          read._tag === "Failure"
            ? `${call.name} failed: ${read.failure.message}`
            : read.success._tag === "Some"
              ? JSON.stringify(read.success.value.encodedResult)
              : `${call.name} answered nothing`,
        ),
      )
    }
    return { offers, run }
  })
