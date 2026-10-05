/** Bearer tokens for `/mcp`: a configured token's role, or 401 when none matches. */
import { createHash, timingSafeEqual } from "node:crypto"
import { Effect, Option, Redacted } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { Configured, type Mcp } from "../settings"

interface McpCaller {
  readonly name: string
  readonly role: "viewer" | "operator"
}

const digest = (text: string) => createHash("sha256").update(text).digest()

/** Whether the bearer matches a token, compared in the same time whatever it is. */
const matches = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected))

const bearerOf = (header: string | undefined): string | undefined => {
  if (header === undefined || !header.startsWith("Bearer ")) return undefined
  const token = header.slice("Bearer ".length).trim()
  return token === "" ? undefined : token
}

const findCaller = (mcp: Mcp | undefined, given: string | undefined): McpCaller | undefined => {
  if (mcp === undefined || given === undefined) return undefined
  for (const each of mcp.tokens) {
    if (matches(given, Redacted.value(each.token))) return { name: each.name, role: each.role }
  }
  return undefined
}

/** Middleware: `/mcp` only proceeds for a matching bearer token; otherwise 401. */
export const mcpAuth = HttpRouter.middleware((httpEffect) =>
  Effect.gen(function* () {
    // Configured is on the request context; serviceOption keeps middleware requires empty so `.layer` types.
    const configured = yield* Effect.serviceOption(Configured)
    const request = yield* HttpServerRequest.HttpServerRequest
    const caller = Option.flatMap(configured, (settings) =>
      Option.fromNullishOr(findCaller(settings.mcp, bearerOf(request.headers["authorization"]))),
    )
    if (Option.isNone(caller)) return HttpServerResponse.empty({ status: 401 })
    return yield* httpEffect
  }),
)
