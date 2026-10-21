import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import type { AskAnswer } from "../../shared/ask"
import type { Catalog, Store } from "../../shared/catalog"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import { exporter } from "../fixture-kafka"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"

const bus: Store = { name: "bus", environments: ["staging"], engine: "kafka", selector: 'job="kafka"' }
const withBus: Catalog = { ...catalog, stores: [bus, { ...bus, name: "orders-db", engine: "cnpg" }] }

const configured = (ai: boolean): Settings => ({
  ...settings({ anonymous: { name: "gil", role: "operator" } }),
  sources: { staging: { prometheus: { url: "http://prometheus" } } },
  ...(ai
    ? {
        ai: {
          provider: "openai-compatible" as const,
          url: "http://model.test/v1",
          model: "fake-model",
          apiKey: Redacted.make("sk-test"),
        },
      }
    : {}),
})

const answer = {
  likelyCause: "Broker 3 left the cluster, so its partitions lost a replica and orders 2 lost its leader.",
  evidence: [{ text: "broker 3 not seen for 10 min" }],
  nextSteps: ["bring broker 3 back"],
  confidence: "high",
}

/** The exporter and the model as stubs, the briefs the model was sent kept. */
const answering = (briefs: Array<string>) => {
  const cluster = exporter(Date.now() / 1000)
  return (call: Call): Reply | undefined => {
    if (!call.url.includes("/chat/completions")) return cluster(call)
    briefs.push(JSON.parse(call.body ?? "{}").messages.at(-1).content)
    return reply({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { total_tokens: 300 } })
  }
}

const post = (path: string) => new Request(`http://estate${path}`, { method: "POST" })

describe("Ask AI about a Kafka store's cluster", () => {
  test("reads the cluster, sends it as the brief, and answers with a cause, evidence and next steps", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const briefs: Array<string> = []
        const server = yield* serverFor(configured(true), estate({ catalog: withBus }), answering(briefs))
        const answered = yield* ask(server, post("/api/stores/bus/ask?env=staging"))
        const body = answered.json() as AskAnswer
        expect(answered.status).toBe(200)
        expect([body.likelyCause, body.confidence, body.read, body.readLogs]).toEqual([
          answer.likelyCause,
          "high",
          ["Cluster"],
          false,
        ])
        expect(briefs[0]).toContain("broker 3 (kafka-2:9092): gone, last seen 600 s ago")
        expect(briefs[0]).toContain("orders p2: no leader, 2 of 3 replicas in sync")
        expect(briefs[0]).toContain("orders-projector: 3 members, reads 230 a second, lag 12010, growing 40 a second")
      }),
    ))

  test("is not there without Ask AI, or for a store that is not Kafka", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const off = yield* serverFor(configured(false), estate({ catalog: withBus }), answering([]))
        const none = yield* ask(off, post("/api/stores/bus/ask?env=staging"))
        expect([none.status, none.json()]).toEqual([404, { message: "Ask AI is not configured" }])
        const on = yield* serverFor(configured(true), estate({ catalog: withBus }), answering([]))
        const cnpg = yield* ask(on, post("/api/stores/orders-db/ask?env=staging"))
        expect([cnpg.status, cnpg.json()]).toEqual([404, { message: "orders-db is not a Kafka store" }])
      }),
    ))
})
