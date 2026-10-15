import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"

const withAi = (tokensPerDay?: number): Settings => ({
  ...settings({ anonymous: { name: "gil", role: "operator" } }),
  ai: {
    provider: "openai-compatible",
    url: "http://model.test/v1",
    model: "fake-model",
    apiKey: Redacted.make("sk-test"),
    ...(tokensPerDay === undefined ? {} : { budget: { tokensPerDay } }),
  },
})

const ok = <A>(value: A) => ({ state: "ok" as const, value, answeredAt: "2026-10-03T12:00:00Z" })

const withAlert = estate({
  catalog,
  environments: {
    production: environment({
      alerts: ok([
        {
          id: "a1",
          name: "OrdersSlow",
          state: "firing",
          severity: "warning",
          startsAt: "2026-10-03T11:46:00Z",
          labels: { service: "storefront" },
        },
        {
          id: "a2",
          name: "Other",
          state: "firing",
          severity: "warning",
          startsAt: "2026-10-03T11:46:00Z",
          labels: { service: "orders" },
        },
      ]),
      deploys: ok({ storefront: { version: "v2", ready: true, at: "2026-10-03T11:20:00Z" } }),
    }),
  },
})

const modelReply = (call: Call): Reply | undefined => {
  if (!call.url.includes("/chat/completions")) return undefined
  const answer = {
    likelyCause: "A recent deploy raised latency.",
    evidence: [{ text: "storefront v2 deployed before it fired" }],
    nextSteps: ["Check the runbook"],
    confidence: "medium",
  }
  return reply({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { total_tokens: 400 } })
}

const asked = (alert: string) => new Request(`http://estate/api/alerts/${alert}/ask?env=production`, { method: "POST" })

describe("POST /api/alerts/:id/ask", () => {
  test("answers with the model's reading of the brief, the model's name and what it read", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(), withAlert, (call) => {
          calls.push(call)
          return modelReply(call)
        })
        return yield* ask(server, asked("a1"))
      }),
    ).then((answer) => {
      expect([answer.status, answer.json()]).toEqual([
        200,
        {
          likelyCause: "A recent deploy raised latency.",
          evidence: [{ text: "storefront v2 deployed before it fired" }],
          nextSteps: ["Check the runbook"],
          confidence: "medium",
          model: "fake-model",
          read: ["Changed", "Depends"],
          called: [],
          usage: { input: 400, cached: 0, output: 0 },
          readLogs: false,
        },
      ])
      expect(calls.find((call) => call.url.endsWith("/chat/completions"))?.body).toContain(
        "storefront: v2 deployed, 26 min before it fired",
      )
    })
  })

  test("is not found without ai or without the alert, and says why the model failed", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const bare = yield* serverFor(settings({ anonymous: { name: "gil", role: "operator" } }), withAlert)
        const broken = yield* serverFor(withAi(), withAlert, (call) =>
          call.url.includes("/chat/completions") ? reply("down", 500) : undefined,
        )
        return [
          yield* ask(bare, asked("a1")),
          yield* ask(broken, asked("nope")),
          yield* ask(broken, asked("a2")),
          // A failed ask gives its turn back, so it can be asked again at once.
          yield* ask(broken, asked("a2")),
        ].map((answer) => [answer.status, answer.json()])
      }),
    ).then((answers) =>
      expect(answers).toEqual([
        [404, { message: "Ask AI is not configured" }],
        [404, { message: "there is no alert nope in production" }],
        [502, { message: "the model answered 500" }],
        [502, { message: "the model answered 500" }],
      ]),
    ))

  test("shares an alert's answer within the minute rather than refusing, and nothing once the day's tokens are spent", () => {
    let called = 0
    const counting = (call: Call) => {
      if (call.url.includes("/chat/completions")) called += 1
      return modelReply(call)
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(500), withAlert, counting)
        const [first, together] = yield* Effect.all([ask(server, asked("a1")), ask(server, asked("a1"))], {
          concurrency: "unbounded",
        })
        const after = yield* ask(server, asked("a1"))
        const spent = yield* ask(server, asked("a2"))
        const refused = yield* ask(server, asked("a2"))
        return {
          called,
          answers: [first, together, after, spent, refused].map((answer) => ({
            status: answer.status,
            body: answer.json(),
          })),
        }
      }),
    ).then(({ called, answers }) => {
      expect(called).toBe(2)
      expect(answers[1]).toEqual(answers[0])
      expect(answers[2]).toEqual(answers[0])
      expect(answers[0]?.status).toBe(200)
      expect(answers[3]?.status).toBe(200)
      // a2's own answer is shared too, though the day's tokens are spent: sharing costs none.
      expect(answers[4]).toEqual(answers[3])
    })
  })

  test("refuses a new ask once the day's tokens are spent", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(300), withAlert, modelReply)
        return [yield* ask(server, asked("a1")), yield* ask(server, asked("a2"))].map((answer) => [
          answer.status,
          (answer.json() as { message?: string }).message,
        ])
      }),
    ).then((answers) =>
      expect(answers).toEqual([
        [200, undefined],
        [429, "Ask AI has used today's 300 tokens"],
      ]),
    ))

  test("says what the answer took, and what it cost where the model has a price", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const priced = { ...withAi(), prices: { "fake-model": { input: 3, output: 15 } } }
        const unpriced = yield* serverFor(withAi(), withAlert, modelReply)
        const server = yield* serverFor(priced, withAlert, modelReply)
        return [(yield* ask(server, asked("a1"))).json(), (yield* ask(unpriced, asked("a1"))).json()] as const
      }),
    ).then(([withPrice, without]) => {
      expect(withPrice).toMatchObject({
        usage: { input: 400, cached: 0, output: 0 },
        cost: { amount: 0.0012, currency: "USD" },
      })
      expect(without).toMatchObject({ usage: { input: 400, cached: 0, output: 0 } })
      expect(without).not.toHaveProperty("cost")
    }))

  test("lets the model call Estate's read tools as the person asking, and says which it called", () => {
    const sent: Array<string> = []
    const curious = (call: Call): Reply | undefined => {
      if (!call.url.includes("/chat/completions")) return undefined
      sent.push(call.body ?? "")
      const body = JSON.parse(call.body ?? "{}")
      return body.messages.some((message: { role: string }) => message.role === "tool")
        ? modelReply(call)
        : reply({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    { id: "c1", function: { name: "service", arguments: '{"name":"storefront"}' } },
                    // A tool Estate does not offer, and one asked for wrongly: each is told so, and the ask goes on.
                    { id: "c2", function: { name: "silence", arguments: "{}" } },
                    { id: "c3", function: { name: "service", arguments: "{}" } },
                  ],
                },
              },
            ],
          })
    }
    return Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(withAi(), withAlert, curious)
        return yield* ask(server, asked("a1"))
      }),
    ).then((answer) => {
      expect((answer.json() as { called: ReadonlyArray<string> }).called).toEqual([
        "service storefront",
        "silence",
        "service",
      ])
      // The tools offered are the read ones, and the service's own answer went back to the model.
      expect(
        JSON.parse(sent[0] ?? "{}").tools.map((tool: { function: { name: string } }) => tool.function.name),
      ).toEqual(["service", "changes", "alert_history", "errors", "alerts"])
      expect(sent[1]).toContain('\\"name\\":\\"storefront\\"')
      expect(sent[1]).toContain("there is no tool silence")
      // The tools answer about the alert's environment, and say why where they cannot.
      expect(sent[1]).toContain("storefront is attention: OrdersSlow is firing")
      expect(sent[1]).toContain("ToolParameterValidationError")
    })
  })
})
