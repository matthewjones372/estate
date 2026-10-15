/**
 * `POST /api/alerts/:id/ask?env=`: Ask AI about an alert. The model reads the alert's brief, *Around this alert*,
 * may call Estate's read tools as the person asking, and answers with a likely cause, its evidence and what to do next.
 * Asked again within the minute by anyone who may read the same, it gives that answer, waiting for it while it is
 * being asked. It is 404 when `ai` is not set, 429 when the day's tokens are spent, and 502 when the model failed.
 */
import { Effect, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import type { AskAnswer } from "../../shared/ask"
import { briefText, gatherAround, sectionsOf } from "../around"
import { budgeted, costOf } from "../ask-cost"
import { AskLimits } from "../ask-limits"
import { firingNow, happened } from "../happened"
import { Model } from "../model"
import { Configured } from "../settings"
import { Estate } from "../state"
import { askTools } from "./ask-tools"
import { EnvParam, json, readsLogs, refused, searchParams, writer } from "./routes"

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
    // Keyed by whether the asker may read logs, the one thing the tools read differently by role, so an answer drawn
    // from logs is never shared with someone who may not read them.
    const reads = yield* readsLogs(person.role)
    const turn = `${environment}\u0000${id}\u0000${reads ? "logs" : "no-logs"}`
    const limited = yield* Effect.result(limits.take(turn))
    if (limited._tag === "Failure") {
      const shared = yield* limits.shared(turn)
      return shared === undefined ? json({ message: limited.failure.message }, 429) : json(shared)
    }
    // The model reads what this person could read on the page, and no more.
    const brief = yield* gatherAround(environment, id, reads)
    if (brief === undefined) {
      yield* limits.giveBack(turn)
      return json({ message: `there is no alert ${id} in ${environment}` }, 404)
    }
    const model = yield* Model
    const firing = yield* firingNow(environment, id)
    yield* happened(firing, person.name, "ai-asked", settings.ai.model)
    const { tools, readLogs: toolReadLogs } = yield* askTools({ name: person.name, role: person.role }, environment)
    const result = yield* Effect.result(
      model.ask(briefText(brief), `What is the likely cause of ${brief.name}, and what should we do next?`, tools),
    )
    if (result._tag === "Failure") {
      yield* limits.giveBack(turn)
      yield* happened(firing, "Estate", "ai-failed", result.failure.message)
      return json({ message: result.failure.message }, 502)
    }
    const read = sectionsOf(brief)
    // Logs were read if the brief carried them, or the model called `errors` and was answered.
    const readLogs = read.includes("Errors") || (yield* toolReadLogs)
    yield* happened(
      firing,
      "Estate",
      "ai-answered",
      `${result.success.answer.likelyCause} (${result.success.answer.confidence})`,
      { readLogs },
    )
    const { answer, model: name, called, usage } = result.success
    const price = settings.prices?.[name]
    yield* limits.spend(budgeted(usage, price))
    const currency = settings.sources[environment]?.costs?.currency ?? "USD"
    const body: AskAnswer = {
      ...answer,
      model: name,
      read,
      called,
      usage,
      readLogs,
      ...(price === undefined ? {} : { cost: { amount: costOf(usage, price), currency } }),
    }
    yield* limits.keep(turn, body)
    return json(body)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
