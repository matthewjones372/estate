/**
 * `POST /api/incidents/:id/summary`: Summarise (spec 0051). The model reads the incident as this person may read it,
 * with what was included and kept, and writes an account of it in one round, with no tools. It shares Ask AI's model,
 * day's budget and minute's turn: asked again within the minute by someone who reads the same, it gives that answer.
 * It is 404 when `ai` is not set, 429 when the day's tokens are spent, and 502 when the model failed.
 */
import { Effect } from "effect"
import { HttpRouter } from "effect/http"
import { IncidentSummary, type SummaryAnswer } from "../../shared/summary"
import { budgeted, costOf } from "../ask-cost"
import { AskLimits } from "../ask-limits"
import { happenedOnIncident } from "../happened"
import { briefReadsLogs, incidentBrief } from "../incident-brief"
import { Model, type Shape } from "../model"
import { Configured } from "../settings"
import { recordFor } from "./incident-read"
import { named } from "./incident-record"
import { json, readsLogs, refused, writer } from "./routes"

const summary: Shape<IncidentSummary, typeof IncidentSummary.Encoded> = {
  system: `You are Estate's incident writer. From the incident you are given, and nothing else, write a short account
for a review and a status update. Say only what the brief shows; where it does not show the impact or the cause, say
so with low confidence. Reply with one JSON object and nothing else:
{"what": string, "impact": string, "cause": string, "turns": [{"at": string, "text": string}],
 "followUps": [string], "confidence": "low" | "medium" | "high"}. "what" is three to five sentences in order; "turns"
are the moments that mattered, each at a time from the timeline.`,
  answer: IncidentSummary,
  tidy: (answer) => answer,
}

export const incidentSummaryRoute = HttpRouter.add(
  "POST",
  "/api/incidents/:id/summary",
  Effect.gen(function* () {
    const person = yield* writer
    const settings = yield* Configured
    if (settings.ai === undefined) return json({ message: "Ask AI is not configured" }, 404)
    const { id = "" } = yield* HttpRouter.params
    const incident = yield* named(id)
    const reads = yield* readsLogs(person.role)
    const limits = yield* AskLimits
    // Keyed apart from any alert's, and by whether the asker reads logs, so a summary drawn from them is not shared.
    const turn = `incident\u0000${id}\u0000${reads ? "logs" : "no-logs"}`
    const limited = yield* Effect.result(limits.take(turn))
    if (limited._tag === "Failure") {
      const shared = yield* limits.shared(turn)
      return shared === undefined ? json({ message: limited.failure.message }, 429) : json(shared)
    }
    const record = yield* recordFor(incident, reads)
    const readLogs = briefReadsLogs(record)
    yield* happenedOnIncident(id, person.name, "ai-asked", `summarise (${settings.ai.model})`)
    const result = yield* Effect.result(
      (yield* Model).answer(summary, incidentBrief(record), `Summarise the incident "${incident.title}".`),
    )
    if (result._tag === "Failure") {
      yield* limits.giveBack(turn)
      yield* happenedOnIncident(id, "Estate", "ai-failed", result.failure.message)
      return json({ message: result.failure.message }, 502)
    }
    const { answer, model, usage } = result.success
    yield* happenedOnIncident(id, "Estate", "ai-answered", `${answer.what} (${answer.confidence})`, undefined, {
      readLogs,
    })
    const price = settings.prices?.[model]
    yield* limits.spend(budgeted(usage, price))
    const body: SummaryAnswer = {
      ...answer,
      model,
      usage,
      readLogs,
      ...(price === undefined ? {} : { cost: { amount: costOf(usage, price), currency: "USD" } }),
    }
    yield* limits.keep(turn, body)
    return json(body)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
