import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { ask, catalog, estate, serverFor, settings } from "../fixture"
import { reply } from "../remote"

const withAgent = {
  ...catalog,
  agents: [
    { name: "triage", environments: ["production"], runs: { langfuse: { name: "support-triage" } } },
    { name: "untraced", environments: ["production"] },
  ],
}
const configured = (langfuse: boolean) => ({
  ...settings({ anonymous: { name: "gil", role: "viewer" } }),
  sources: {
    staging: {},
    production: langfuse
      ? {
          langfuse: { url: "https://langfuse.example", publicKey: Redacted.make("pk"), secretKey: Redacted.make("sk") },
        }
      : {},
  },
})
const runs = (agent: string, env = "production") =>
  new Request(`http://estate/api/agents/runs?env=${env}&agent=${agent}`)

describe("an agent's runs", () => {
  test("are read from Langfuse when asked; one with no tool to read is not found, and a failing tool says why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const answering = yield* serverFor(configured(true), estate({ catalog: withAgent }), (call) =>
          call.url.includes("/api/public/traces?") ? reply({ data: [] }) : undefined,
        )
        const failing = yield* serverFor(configured(true), estate({ catalog: withAgent }), () => reply("down", 500))
        const bare = yield* serverFor(configured(false), estate({ catalog: withAgent }))
        return [
          yield* ask(answering, runs("triage")),
          yield* ask(answering, runs("untraced")),
          yield* ask(bare, runs("triage")),
          yield* ask(answering, runs("triage", "nowhere")),
          yield* ask(failing, runs("triage")),
        ].map((answer) => [answer.status, answer.json()])
      }),
    ).then((answers) =>
      expect(answers).toEqual([
        [200, []],
        [404, { message: "untraced has no runs to read in production" }],
        [404, { message: "triage has no runs to read in production" }],
        [404, { message: "triage has no runs to read in nowhere" }],
        [502, { message: "Langfuse answered 500: down" }],
      ]),
    ))
})
