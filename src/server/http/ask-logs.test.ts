import { describe, expect, test } from "bun:test"
import { Context, Effect, Redacted } from "effect"
import { seal } from "../auth/session"
import { ask, environment, estate, type Server, secret, serverFor, settings } from "../fixture"
import { Notes } from "../notes"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"
import type { SourcedAlert } from "../state"

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-03T11:46:00Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}

const withAlert = estate({
  environments: { staging: environment(), production: environment({ alerts: { state: "ok", value: [slow] } }) },
})

const configured = (role: "viewer" | "operator", logs?: "operator"): Settings => ({
  ...settings({ anonymous: { name: "gil", role }, ...(logs === undefined ? {} : { logs }) }),
  sources: { staging: {}, production: { loki: { url: "http://loki" } } },
  ai: {
    provider: "openai-compatible",
    url: "http://model.test/v1",
    model: "fake-model",
    apiKey: Redacted.make("sk-test"),
  },
})

const answer = {
  likelyCause: "A lock timeout on the orders table.",
  evidence: [{ text: "ERROR lock timeout on 7" }],
  nextSteps: ["Look at the orders table's locks"],
  confidence: "medium",
}

const answered = reply({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { total_tokens: 400 } })

const loki = (call: Call): Reply | undefined =>
  call.url.startsWith("http://loki/")
    ? reply({
        status: "success",
        data: {
          resultType: "streams",
          result: [
            { stream: { pod: "orders-1" }, values: [[`${Date.now() - 1000}000000`, "ERROR lock timeout on 7"]] },
          ],
        },
      })
    : undefined

/** A model that answers from the brief, and Loki answering with an error line. */
const fromBrief = (call: Call): Reply | undefined =>
  loki(call) ?? (call.url.includes("/chat/completions") ? answered : undefined)

/** A model that calls `errors` first, and answers once it has read what came back; Loki answers too. */
const callsErrors = (call: Call): Reply | undefined => {
  const found = loki(call)
  if (found !== undefined || !call.url.includes("/chat/completions")) return found
  const body = JSON.parse(call.body ?? "{}")
  return body.messages.some((message: { role: string }) => message.role === "tool")
    ? answered
    : reply({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "c1", function: { name: "errors", arguments: '{"service":"orders"}' } }],
            },
          },
        ],
      })
}

/** Loki fails the brief's read, so the brief has no Errors, and answers the `errors` tool's. */
const quietBrief = () => {
  let lokiCalls = 0
  return (call: Call): Reply | undefined => {
    if (!call.url.startsWith("http://loki/")) return callsErrors(call)
    lokiCalls += 1
    return lokiCalls === 1 ? reply("down", 500) : loki(call)
  }
}

const asked = new Request("http://estate/api/alerts/a1/ask?env=production", { method: "POST" })

const answerAndEvent = (server: Server) =>
  Effect.gen(function* () {
    const body = (yield* ask(server, asked)).json() as { readonly read: ReadonlyArray<string>; readLogs: boolean }
    const events = yield* Context.get(server.context, Notes).events({
      environment: "production",
      alert: "a1",
      startsAt: slow.startsAt,
    })
    return { read: body.read, readLogs: body.readLogs, event: events.find((each) => each.kind === "ai-answered") }
  })

describe("what an Ask AI answer read", () => {
  test("is logs when an operator's brief had Errors, kept on the answer and on its event", () =>
    Effect.runPromise(
      Effect.flatMap(serverFor(configured("operator", "operator"), withAlert, fromBrief), answerAndEvent),
    ).then(({ read, readLogs, event }) => {
      expect(read).toContain("Errors")
      expect(readLogs).toBe(true)
      expect(event).toMatchObject({
        by: "Estate",
        text: "A lock timeout on the orders table. (medium)",
        readLogs: true,
      })
    }))

  test("is not logs when a viewer asks where logs are for operators", () =>
    Effect.runPromise(
      Effect.flatMap(serverFor(configured("viewer", "operator"), withAlert, callsErrors), answerAndEvent),
    ).then(({ read, readLogs, event }) => {
      expect(read).not.toContain("Errors")
      expect(readLogs).toBe(false)
      expect(event).toMatchObject({ readLogs: false })
    }))

  test("is logs when the model called errors and was answered", () =>
    Effect.runPromise(
      Effect.flatMap(serverFor(configured("operator", "operator"), withAlert, quietBrief()), answerAndEvent),
    ).then(({ read, readLogs }) => {
      expect(read).not.toContain("Errors")
      expect(readLogs).toBe(true)
    }))
})

/** Signed in, so a viewer and an operator can ask of one Estate. */
const signedIn = (logs?: "operator"): Settings => ({
  ...configured("viewer", logs),
  auth: settings({
    oidc: {
      issuer: "https://id.example",
      clientId: "estate",
      clientSecret: Redacted.make("s"),
      publicUrl: "https://e",
    },
    ...(logs === undefined ? {} : { logs }),
  }).auth,
})

const askedBy = (groups: ReadonlyArray<string>) =>
  Effect.map(
    seal({ name: groups[0] ?? "", groups }, Date.now() + 60_000, secret),
    (sealed) =>
      new Request("http://estate/api/alerts/a1/ask?env=production", {
        method: "POST",
        headers: { cookie: `estate_session=${sealed}` },
      }),
  )

/** How often the model is called when a viewer, then an operator, ask about one alert within the minute. */
const modelCalls = (logs?: "operator") => {
  let called = 0
  const counting = (call: Call) => {
    if (call.url.includes("/chat/completions")) called += 1
    return fromBrief(call)
  }
  return Effect.gen(function* () {
    const server = yield* serverFor(signedIn(logs), withAlert, counting)
    const answers = [yield* ask(server, yield* askedBy(["developers"])), yield* ask(server, yield* askedBy(["ops"]))]
    return { called, statuses: answers.map((answer) => answer.status) }
  })
}

describe("an answer shared within the minute", () => {
  test("is one call to the model for a viewer and an operator where both read logs", () =>
    Effect.runPromise(modelCalls()).then((asked) => expect(asked).toEqual({ called: 1, statuses: [200, 200] })))

  test("is two where logs are for operators, so an operator's answer never reaches a viewer", () =>
    Effect.runPromise(modelCalls("operator")).then((asked) =>
      expect(asked).toEqual({ called: 2, statuses: [200, 200] }),
    ))
})

describe("who a person is", () => {
  test("says where logs are for operators, so keeping an answer that read them can say who sees it", () =>
    Effect.runPromise(
      Effect.forEach([configured("viewer", "operator"), configured("viewer")], (each) =>
        Effect.flatMap(serverFor(each, withAlert), (server) =>
          Effect.map(ask(server, new Request("http://estate/api/me")), (me) => me.json()),
        ),
      ),
    ).then(([kept, open]) => {
      expect(kept).toMatchObject({ logsForOperators: true })
      expect(open).not.toHaveProperty("logsForOperators")
    }))
})
