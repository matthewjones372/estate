import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer, Redacted } from "effect"
import { ask, environment, estate, type Server, serverFor, settings } from "../fixture"
import { memoryNotes, Notes } from "../notes"
import { type Call, reply } from "../remote"
import { SourceFailure } from "../sources/run"
import type { SourcedAlert } from "../state"

const alert: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-03T11:46:00Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}
const silenced: SourcedAlert = {
  ...alert,
  id: "a2",
  state: "silenced",
  silence: { id: "s9", by: "ada", reason: "resizing", startsAt: "t", endsAt: "t" },
}
const firing = estate({ environments: { staging: environment({ alerts: { state: "ok", value: [alert, silenced] } }) } })

const configured = {
  ...settings({ anonymous: { name: "gil", role: "operator" } }),
  sources: { staging: { alertmanager: { url: "http://alertmanager/" } } },
  ai: {
    provider: "openai-compatible" as const,
    url: "http://model.test/v1",
    model: "fake-model",
    apiKey: Redacted.make("k"),
  },
}

const answering = (call: Call) => {
  if (call.url === "http://alertmanager/api/v2/silences") return reply({ silenceID: "s1" })
  if (call.url === "http://alertmanager/api/v2/silence/s9") return reply("")
  if (!call.url.includes("/chat/completions")) return undefined
  const answer = { likelyCause: "A recent deploy raised latency.", evidence: [], nextSteps: [], confidence: "medium" }
  return reply({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { total_tokens: 400 } })
}

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const eventsOf = (server: Server, id: string) =>
  Context.get(server.context, Notes).events({ environment: "staging", alert: id, startsAt: alert.startsAt })

describe("what people do to a firing", () => {
  test("is kept as its events, each with who did it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured, firing, answering)
        const note = (yield* ask(
          server,
          sending("POST", "/api/notes", { environment: "staging", alert: "a1", text: "On it." }),
        )).json() as { id: string }
        yield* ask(
          server,
          sending("POST", "/api/notes", {
            environment: "staging",
            alert: "a1",
            text: "Ask AI (m): a deploy",
            from: "ask-ai",
          }),
        )
        yield* ask(server, sending("DELETE", `/api/notes/${note.id}`))
        yield* ask(
          server,
          sending("POST", "/api/silences", { environment: "staging", alert: "a1", minutes: 60, reason: "vacuum" }),
        )
        yield* ask(server, sending("PUT", "/api/impacts/OrdersSlow", { text: "Orders are slow to confirm." }))
        yield* ask(server, sending("POST", "/api/alerts/a1/ask?env=staging"))
        yield* ask(server, sending("DELETE", "/api/silences/s9?env=staging"))
        return { a1: yield* eventsOf(server, "a1"), a2: yield* eventsOf(server, "a2") }
      }),
    ).then(({ a1, a2 }) => {
      expect(a1.map((each) => [each.by, each.kind, each.text])).toEqual([
        ["gil", "noted", "On it."],
        ["gil", "ai-kept", "Ask AI (m): a deploy"],
        ["gil", "note-removed", "a note by gil: On it."],
        ["gil", "silenced", "for 1 hour: vacuum"],
        ["gil", "impact-written", "Orders are slow to confirm."],
        ["gil", "ai-asked", "fake-model"],
        ["Estate", "ai-answered", "A recent deploy raised latency. (medium)"],
      ])
      expect(a1.every((each) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(each.at))).toBe(true)
      expect(a2.map((each) => [each.by, each.kind])).toEqual([
        ["gil", "impact-written"],
        ["gil", "unsilenced"],
      ])
    }))

  test("an ask that fails is kept as failing, with why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured, firing, (call) =>
          call.url.includes("/chat/completions") ? reply("down", 500) : undefined,
        )
        yield* ask(server, sending("POST", "/api/alerts/a1/ask?env=staging"))
        return yield* eventsOf(server, "a1")
      }),
    ).then((events) =>
      expect(events.map((each) => [each.by, each.kind, each.text])).toEqual([
        ["gil", "ai-asked", "fake-model"],
        ["Estate", "ai-failed", "the model answered 500"],
      ]),
    ))

  test("is done though its event cannot be kept", () => {
    const refusing = Layer.effect(Notes)(
      Effect.map(Notes, (notes) => ({
        ...notes,
        addEvent: () => Effect.fail(new SourceFailure({ message: "the notes database: down" })),
      })),
    ).pipe(Layer.provide(memoryNotes))
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(configured, firing, answering, refusing)
        const noted = { environment: "staging", alert: "a1", text: "On it." }
        return (yield* ask(server, sending("POST", "/api/notes", noted))).status
      }),
    ).then((status) => expect(status).toBe(201))
  })
})
