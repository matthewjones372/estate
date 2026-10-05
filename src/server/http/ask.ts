/**
 * `POST /api/alerts/:id/ask?env=`: Ask AI about an alert. Streams SSE chunks then a final `answer` event.
 * 404 when ai is not configured; 429 when asked too often for the same alert.
 * Model calls go through Remote (Anthropic, OpenAI, xAI, Gemini, or OpenAI-compatible), never fabricating beyond the around brief.
 */
import { Clock, Context, Data, Effect, Layer, Redacted, Stream, SubscriptionRef } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"
import { type Call, Remote } from "../remote"
import { type Ai, Configured } from "../settings"
import { Estate } from "../state"
import { aroundOf } from "../views/around"
import { EnvParam, json, refused, searchParams, writer } from "./routes"

const ModelError = Data.TaggedError("ModelError")<{ readonly message: string }>
type ModelError = InstanceType<typeof ModelError>

interface AskResult {
  readonly likelyCause: string
  readonly evidence: ReadonlyArray<{ readonly text: string; readonly href?: string }>
  readonly nextSteps: ReadonlyArray<string>
  readonly confidence: "low" | "medium" | "high"
  readonly tools: ReadonlyArray<string>
  readonly model: string
}

export interface Model {
  readonly ask: (brief: string, question: string) => Effect.Effect<AskResult, ModelError>
}
export const Model = Context.Service<Model>("estate/Model")

const system = `You are Estate's incident investigator. Answer ONLY from the brief you are given.
Return a single JSON object with keys: likelyCause, evidence, nextSteps, confidence, tools.
Never invent what is not in the brief.`

const confidences = new Set(["low", "medium", "high"])

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object"

const textField = (value: Record<string, unknown>): string | undefined =>
  typeof value["text"] === "string" ? value["text"] : undefined

const stringItems = (value: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const each of value) if (typeof each === "string") out.push(each)
  return out
}

const failedStatus = (provider: Ai["provider"], status: number): string =>
  provider === "anthropic" ? `Anthropic answered ${status}` : `the model answered ${status}`

const previewOf = (likelyCause: string): string => likelyCause.slice(0, 80)

const parseAnswer = (text: string, model: string): Effect.Effect<AskResult, ModelError> =>
  Effect.gen(function* () {
    const start = text.indexOf("{")
    const end = text.lastIndexOf("}")
    if (start < 0 || end <= start) return yield* new ModelError({ message: "the model did not return JSON" })
    const body = yield* Effect.try({
      try: () => JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>,
      catch: () => new ModelError({ message: "the model's JSON was not an answer" }),
    })
    const likelyCause = body["likelyCause"]
    const confidence = body["confidence"]
    if (typeof likelyCause !== "string") return yield* new ModelError({ message: "the model's JSON was not an answer" })
    if (!Array.isArray(body["evidence"]) || !Array.isArray(body["nextSteps"]) || !Array.isArray(body["tools"]))
      return yield* new ModelError({ message: "the model's JSON was not an answer" })
    if (typeof confidence !== "string" || !confidences.has(confidence))
      return yield* new ModelError({ message: "the model's JSON was not an answer" })
    return {
      likelyCause,
      evidence: body["evidence"].flatMap((each) => {
        if (!isRecord(each)) return []
        const field = textField(each)
        if (field === undefined) return []
        const href = each["href"]
        return typeof href === "string" ? [{ text: field, href }] : [{ text: field }]
      }),
      nextSteps: stringItems(body["nextSteps"]),
      confidence: confidence as "low" | "medium" | "high",
      tools: stringItems(body["tools"]),
      model,
    }
  })

const openAiBase = (ai: Ai): string => {
  if (ai.url !== undefined) return ai.url.replace(/\/$/, "")
  if (ai.provider === "xai") return "https://api.x.ai/v1"
  if (ai.provider === "gemini") return "https://generativelanguage.googleapis.com/v1beta/openai"
  return "https://api.openai.com/v1"
}

const requestOf = (ai: Ai, brief: string, question: string): Effect.Effect<Call, ModelError> => {
  const user = `Brief:\n${brief}\n\nQuestion: ${question}`
  if (ai.provider === "anthropic") {
    const key = ai.apiKey === undefined ? undefined : Redacted.value(ai.apiKey)
    if (key === undefined) return Effect.fail(new ModelError({ message: "ai.apiKey is not set" }))
    return Effect.succeed({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST" as const,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ai.model,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: user }],
      }),
    })
  }
  const base = openAiBase(ai)
  const key = ai.apiKey === undefined ? undefined : Redacted.value(ai.apiKey)
  const headers =
    key === undefined
      ? { "content-type": "application/json" }
      : { "content-type": "application/json", authorization: `Bearer ${key}` }
  return Effect.succeed({
    url: `${base}/chat/completions`,
    method: "POST" as const,
    headers,
    body: JSON.stringify({
      model: ai.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  })
}

const textOf = (ai: Ai, body: unknown): string => {
  if (ai.provider === "anthropic") {
    for (const each of (body as { content?: ReadonlyArray<{ type: string; text?: string }> }).content ?? []) {
      if (each.type === "text" && each.text !== undefined) return each.text
    }
    return ""
  }
  return (body as { choices?: ReadonlyArray<{ message?: { content?: string } }> }).choices?.[0]?.message?.content ?? ""
}

const askProvider = (remote: Remote, ai: Ai, brief: string, question: string) =>
  Effect.gen(function* () {
    const call = yield* requestOf(ai, brief, question)
    const reply = yield* remote.call(call).pipe(Effect.mapError((error) => new ModelError({ message: error.message })))
    if (reply.status >= 300) return yield* new ModelError({ message: failedStatus(ai.provider, reply.status) })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(reply.text) as unknown,
      catch: () => new ModelError({ message: "the model did not return JSON" }),
    })
    return yield* parseAnswer(textOf(ai, parsed), ai.model)
  })

/** A live model from `settings.ai`, failing when Ask AI is not configured. */
export const liveModel = (ai: Ai | undefined): Layer.Layer<Model, never, Remote> =>
  Layer.effect(Model)(
    Effect.gen(function* () {
      const remote = yield* Remote
      return {
        ask: (brief: string, question: string) =>
          ai === undefined
            ? Effect.fail(new ModelError({ message: "Ask AI is not configured" }))
            : askProvider(remote, ai, brief, question),
      }
    }),
  )

const lastAsked = new Map<string, number>()
export const resetAskLimits = () => lastAsked.clear()
const coolDownMs = 60_000

const coolKey = (environment: string, id: string): string => `${environment}:${id}`

const isCooling = (key: string, now: number): boolean => {
  const previous = lastAsked.get(key)
  return previous !== undefined && now - previous < coolDownMs
}

const rememberAsk = (key: string, now: number): void => {
  lastAsked.set(key, now)
}

const frame = (event: string, data: string) => `event: ${event}\ndata: ${data}\n\n`

const errorFrame = (message: string) => frame("error", message)

const answerFrames = (answer: AskResult): ReadonlyArray<string> => [
  frame("chunk", previewOf(answer.likelyCause)),
  frame(
    "answer",
    JSON.stringify({
      likelyCause: answer.likelyCause,
      evidence: answer.evidence,
      nextSteps: answer.nextSteps,
      confidence: answer.confidence,
      tools: answer.tools,
      model: answer.model,
    }),
  ),
]

export const askRoute = HttpRouter.add(
  "POST",
  "/api/alerts/:id/ask",
  Effect.gen(function* () {
    yield* writer
    const settings = yield* Configured
    if (settings.ai === undefined) return json({ message: "Ask AI is not configured" }, 404)
    const { id = "" } = yield* HttpRouter.params
    const { env: asked } = yield* searchParams(EnvParam, "env names an environment")
    const estate = yield* SubscriptionRef.get(yield* Estate)
    const environment = asked ?? estate.catalog.environments[0]?.name ?? ""
    if (!estate.catalog.environments.some((each) => each.name === environment))
      return json({ message: `${environment} is not an environment` }, 404)
    const brief = aroundOf(estate, environment, id)
    if (brief === undefined) return json({ message: `there is no alert ${id}` }, 404)
    const key = coolKey(environment, id)
    const now = yield* Clock.currentTimeMillis
    if (isCooling(key, now)) return json({ message: "Ask AI is rate-limited; try again in a minute" }, 429)
    rememberAsk(key, now)
    const model = yield* Model
    const question = `What is the likely cause of ${brief.name}, and what should we do next?`
    const result = yield* Effect.result(model.ask(brief.summaryText, question))
    if (result._tag === "Failure") {
      return HttpServerResponse.stream(Stream.make(errorFrame(result.failure.message)).pipe(Stream.encodeText), {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      })
    }
    const body = Stream.make(...answerFrames(result.success)).pipe(Stream.encodeText)
    return HttpServerResponse.stream(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    })
  }).pipe(Effect.catchTag("Refusal", refused)),
)
