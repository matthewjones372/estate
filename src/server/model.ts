/**
 * The model Ask AI asks, behind one port. It reads the alert's brief and may call Estate's read tools a few times for
 * what the brief does not answer, then answers in the shape it was asked for. Every call goes through `Remote`, and
 * every reply is decoded, so a provider answering in an unexpected shape is a `ModelError`, never a crash.
 */
import { Context, Data, Effect, Layer, Schema } from "effect"
import { ModelAnswer } from "../shared/ask"
import { apiOf, type Conversation, started, type ToolCall, type ToolOffer, type Turn } from "./model-apis"
import { Remote } from "./remote"
import type { Ai } from "./settings"

const ModelError = Data.TaggedError("ModelError")<{ readonly message: string }>
type ModelError = InstanceType<typeof ModelError>

/** The read tools a model may call, and how each call is answered, as text for the model to read. */
export interface Tools {
  readonly offers: ReadonlyArray<ToolOffer>
  readonly run: (call: ToolCall) => Effect.Effect<string>
}

/** What a model answered, the tools it called, and how many tokens it took, for the day's budget. */
interface Asked {
  readonly answer: ModelAnswer
  readonly model: string
  readonly called: ReadonlyArray<string>
  readonly tokens: number
}

export interface Model {
  readonly ask: (brief: string, question: string, tools?: Tools) => Effect.Effect<Asked, ModelError>
}
export const Model = Context.Service<Model>("estate/Model")

/** Rounds of tool calls before the model is told to answer with what it has. */
const rounds = 4

const system = `You are Estate's incident investigator. Answer from the brief you are given and, where it does not
say enough, from Estate's read tools; never from guesses. If what you read does not show the cause, say so with low
confidence. When you have answered, reply with one JSON object and nothing else:
{"likelyCause": string, "evidence": [{"text": string, "href"?: string}], "nextSteps": [string],
 "confidence": "low" | "medium" | "high"}. Each piece of evidence quotes what you read.`

const decodeAnswer = Schema.decodeUnknownEffect(Schema.fromJsonString(ModelAnswer))

/** The JSON object in what the model wrote, past any prose or code fence around it. */
const objectIn = (text: string): string => text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)

/** Evidence links only to web pages: a model's `javascript:` or file link is dropped, the evidence kept. */
const safely = (answer: ModelAnswer): ModelAnswer => ({
  ...answer,
  evidence: answer.evidence.map(({ text, href }) =>
    href !== undefined && /^https?:\/\//i.test(href) ? { text, href } : { text },
  ),
})

/** A tool call as the page lists it: its name and what it was asked about. */
const calledAs = ({ name, input }: ToolCall): string => {
  const about =
    typeof input === "object" && input !== null
      ? Object.values(input).filter((value): value is string => typeof value === "string")
      : []
  return about.length === 0 ? name : `${name} ${about.join(" ")}`
}

interface Talk {
  readonly conversation: Conversation
  readonly turn: Turn
  readonly called: ReadonlyArray<string>
  readonly tokens: number
  readonly round: number
}

const askWith = (remote: Remote, ai: Ai, brief: string, question: string, tools: Tools | undefined) => {
  const api = apiOf(ai)
  const turnOf = (conversation: Conversation, offers: ReadonlyArray<ToolOffer>) =>
    Effect.gen(function* () {
      const reply = yield* remote
        .call(api.call(conversation, offers))
        .pipe(Effect.mapError((error) => new ModelError({ message: error.message })))
      if (reply.status < 200 || reply.status > 299)
        return yield* new ModelError({ message: `${api.name} answered ${reply.status}` })
      return yield* api
        .read(reply.text)
        .pipe(Effect.mapError(() => new ModelError({ message: `${api.name}'s reply was not in its API's shape` })))
    })
  // Each round answers the tools the model asked for; past the last, none are offered, so it answers with what it read.
  const next = (talk: Talk, offered: Tools): Effect.Effect<Talk, ModelError> =>
    Effect.gen(function* () {
      const results = yield* Effect.forEach(talk.turn.calls, (call) =>
        Effect.map(offered.run(call), (content) => ({ id: call.id, content })),
      )
      const conversation = api.answered(talk.conversation, talk.turn, results)
      const turn = yield* turnOf(conversation, talk.round < rounds ? offered.offers : [])
      return {
        conversation,
        turn,
        called: [...talk.called, ...talk.turn.calls.map(calledAs)],
        tokens: talk.tokens + turn.tokens,
        round: talk.round + 1,
      }
    })
  const talking = (talk: Talk): Effect.Effect<Talk, ModelError> =>
    talk.turn.calls.length === 0 || tools === undefined
      ? Effect.succeed(talk)
      : Effect.flatMap(next(talk, tools), talking)
  return Effect.gen(function* () {
    const conversation = started(system, `Brief:\n${brief}\n\nQuestion: ${question}`)
    const turn = yield* turnOf(conversation, tools?.offers ?? [])
    const talk = yield* talking({ conversation, turn, called: [], tokens: turn.tokens, round: 1 })
    const answer = yield* decodeAnswer(objectIn(talk.turn.text)).pipe(
      Effect.mapError(() => new ModelError({ message: "the model did not answer in the shape it was asked for" })),
    )
    return { answer: safely(answer), model: ai.model, called: talk.called, tokens: talk.tokens }
  })
}

/** The model `settings.ai` names; without one, every ask fails saying so. */
export const liveModel = (ai: Ai | undefined): Layer.Layer<Model, never, Remote> =>
  Layer.effect(Model)(
    Effect.gen(function* () {
      const remote = yield* Remote
      return {
        ask: (brief: string, question: string, tools?: Tools) =>
          ai === undefined
            ? Effect.fail(new ModelError({ message: "Ask AI is not configured" }))
            : askWith(remote, ai, brief, question, tools),
      }
    }),
  )
