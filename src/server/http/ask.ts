/**
 * `POST /api/alerts/:id/ask?env=`: Ask AI about an alert. The model reads the alert's brief, *Around this alert*,
 * may call Estate's read tools as the person asking, and answers with a likely cause, its evidence and what to do next. 404 when `ai` is not set; 429 when the
 * alert was asked about within the minute or the day's tokens are spent; 502 when the model failed.
 */
import { Effect, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import type { AskAnswer } from "../../shared/ask"
import { briefText, gatherAround, sectionsOf } from "../around"
import { AskLimits } from "../ask-limits"
import { Model } from "../model"
import { Configured } from "../settings"
import { Estate } from "../state"
import { askTools } from "./ask-tools"
import { EnvParam, json, refused, searchParams, writer } from "./routes"

export const askRoute = HttpRouter.add(
  "POST",
  "/api/alerts/:id/ask",
  Effect.gen(function* () {
    const person = yield* writer
    const settings = yield* Configured
    if (settings.ai === undefined) return json({ message: "Ask AI is not configured" }, 404)
    const { id = "" } = yield* HttpRouter.params
    const { env: asked } = yield* searchParams(EnvParam, "env names an environment")
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? catalog.environments[0]?.name ?? ""
    const limits = yield* AskLimits
    const turn = `${environment}\u0000${id}`
    const limited = yield* Effect.result(limits.take(turn))
    if (limited._tag === "Failure") return json({ message: limited.failure.message }, 429)
    // The model reads what this person could read on the page, and no more.
    const brief = yield* gatherAround(environment, id, settings.auth.logs !== "operator" || person.role === "operator")
    if (brief === undefined) {
      yield* limits.giveBack(turn)
      return json({ message: `there is no alert ${id} in ${environment}` }, 404)
    }
    const model = yield* Model
    const tools = yield* askTools({ name: person.name, role: person.role }, environment)
    const result = yield* Effect.result(
      model.ask(briefText(brief), `What is the likely cause of ${brief.name}, and what should we do next?`, tools),
    )
    if (result._tag === "Failure") {
      yield* limits.giveBack(turn)
      return json({ message: result.failure.message }, 502)
    }
    yield* limits.spend(result.success.tokens)
    const { answer, model: name, called } = result.success
    const body: AskAnswer = { ...answer, model: name, read: sectionsOf(brief), called }
    return json(body)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
