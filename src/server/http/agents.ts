/** `GET /api/agents/runs?env=…&agent=…`: an agent's recent runs from the tool that traces them, read when asked. */
import { Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { Configured } from "../settings"
import { agentRuns } from "../sources/langfuse"
import { Estate } from "../state"
import { agentsIn } from "../views/catalog"
import { json, Refusal, refused, searchParams, writer } from "./routes"

const Asked = Schema.Struct({ env: Schema.String, agent: Schema.String })

export const agentRunsRoute = HttpRouter.add(
  "GET",
  "/api/agents/runs",
  Effect.gen(function* () {
    yield* writer
    const { env, agent } = yield* searchParams(Asked, "runs are asked for by env and agent")
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const settings = yield* Configured
    const found = catalog.environments.find((each) => each.name === env)
    const described = agentsIn(catalog, env).find((each) => each.name === agent)
    const langfuse = found === undefined ? undefined : settings.sources[found.sources]?.langfuse
    const traced = described?.runs?.langfuse
    if (langfuse === undefined || traced === undefined)
      return yield* new Refusal({ status: 404, body: { message: `${agent} has no runs to read in ${env}` } })
    const read = yield* Effect.result(agentRuns(langfuse, traced.name))
    return read._tag === "Failure" ? json({ message: read.failure.message }, 502) : json(read.success)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
