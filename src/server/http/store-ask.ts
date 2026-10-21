/**
 * `POST /api/stores/:name/ask?env=`: Ask AI about a Kafka store's cluster (spec 0057). The model reads the cluster as
 * Estate read it now and answers in one round, with no tools, with a likely cause, its evidence and what to do next. It
 * shares Ask AI's model, day's budget and minute's turn. It is 404 when `ai` is not set or the store is not Kafka, 429
 * when the day's tokens are spent, and 502 when the model failed.
 */
import { Clock, Effect, Schema, SubscriptionRef } from "effect"
import { HttpRouter } from "effect/http"
import { type AskAnswer, ModelAnswer } from "../../shared/ask"
import { budgeted, costOf } from "../ask-cost"
import { AskLimits } from "../ask-limits"
import { clusterBrief } from "../cluster-brief"
import { Model, type Shape, safely } from "../model"
import { Configured } from "../settings"
import { readCluster } from "../sources/kafka-cluster"
import { rangesIn } from "../sources/ranges"
import { Estate } from "../state"
import { storesIn } from "../views/stores"
import { json, refused, searchParams, writer } from "./routes"

const clusterAnswer: Shape<ModelAnswer, typeof ModelAnswer.Encoded> = {
  system: `You are Estate's Kafka investigator. From the cluster you are given, and nothing else, say what is wrong
with it and why, or that it is well. Say only what the brief shows; where it does not show the cause, say so with low
confidence. Reply with one JSON object and nothing else:
{"likelyCause": string, "evidence": [{"text": string}], "nextSteps": [string], "confidence": "low" | "medium" | "high"}.
Each piece of evidence quotes a line of the brief.`,
  answer: ModelAnswer,
  tidy: safely,
}

const Asked = Schema.Struct({ env: Schema.String })

export const storeAskRoute = HttpRouter.add(
  "POST",
  "/api/stores/:name/ask",
  Effect.gen(function* () {
    yield* writer
    const settings = yield* Configured
    if (settings.ai === undefined) return json({ message: "Ask AI is not configured" }, 404)
    const { name = "" } = yield* HttpRouter.params
    const { env } = yield* searchParams(Asked, "a store's cluster is asked about by env")
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const environment = catalog.environments.find((each) => each.name === env)
    const store = storesIn(catalog, env).find((each) => each.name === name)
    if (environment === undefined || store === undefined) return json({ message: "no such environment or store" }, 404)
    if (store.engine !== "kafka") return json({ message: `${store.name} is not a Kafka store` }, 404)
    const ranges = yield* rangesIn(settings.sources[environment.sources] ?? {})
    if (ranges === undefined) return json({ message: `${environment.name} has no metrics to read` }, 404)
    const limits = yield* AskLimits
    // Keyed apart from any alert's or incident's; a cluster's brief holds no logs, so everyone shares it.
    const turn = `store\u0000${env}\u0000${name}`
    const limited = yield* Effect.result(limits.take(turn))
    if (limited._tag === "Failure") {
      const shared = yield* limits.shared(turn)
      return shared === undefined ? json({ message: limited.failure.message }, 429) : json(shared)
    }
    const now = yield* Clock.currentTimeMillis
    const cluster = yield* Effect.result(readCluster(ranges, store, now / 1000))
    if (cluster._tag === "Failure") {
      yield* limits.giveBack(turn)
      return json({ message: cluster.failure.message }, 404)
    }
    const result = yield* Effect.result(
      (yield* Model).answer(
        clusterAnswer,
        clusterBrief(store, env, cluster.success),
        `What is wrong with the Kafka cluster ${store.name}, and what should we do next?`,
      ),
    )
    if (result._tag === "Failure") {
      yield* limits.giveBack(turn)
      return json({ message: result.failure.message }, 502)
    }
    const { answer, model, usage } = result.success
    const price = settings.prices?.[model]
    yield* limits.spend(budgeted(usage, price))
    const currency = settings.sources[environment.sources]?.costs?.currency ?? "USD"
    const body: AskAnswer = {
      ...answer,
      model,
      read: ["Cluster"],
      called: [],
      usage,
      readLogs: false,
      ...(price === undefined ? {} : { cost: { amount: costOf(usage, price), currency } }),
    }
    yield* limits.keep(turn, body)
    return json(body)
  }).pipe(Effect.catchTag("Refusal", refused)),
)
