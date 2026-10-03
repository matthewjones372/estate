import { describe, expect, test } from "bun:test"
import { Effect, Layer, Redacted } from "effect"
import type { Agent } from "../shared/catalog"
import { agentsFindings } from "./doctor-agents"
import { platform } from "./platform"
import { reply, stubRemote } from "./remote"
import type { Ranges } from "./sources/prometheus"
import { SourceFailure } from "./sources/run"

const triage: Agent = {
  name: "triage",
  environments: ["production"],
  usage: { runs: "runs", tokens: "tokens", spent: "spent", model: "model" },
  budget: { tokens: 1000, per: "day" },
  runs: { langfuse: { name: "support-triage" } },
}
const untold: Agent = { name: "summariser", environments: ["production"], usage: { model: "model" } }
const ranges = (labels: ReadonlyArray<Record<string, string>>): Ranges => ({
  range: (query) => Effect.succeed({ now: query === "runs" ? 0.5 : query.length, points: [] }),
  rules: Effect.succeed(new Map()),
  labels: () => Effect.succeed(labels),
})
const langfuse = { url: "https://langfuse.example", publicKey: Redacted.make("pk"), secretKey: Redacted.make("sk") }
const answer = (url: string) =>
  url.includes("/api/public/traces?")
    ? reply({ data: [{ id: "t1" }] })
    : reply({ id: "t1", timestamp: "2026-10-03T12:00:00Z", observations: [{ type: "SPAN", level: "ERROR" }] })
const run = <A>(effect: Effect.Effect<A, never, never>) => Effect.runPromise(effect)
const remote = (respond: (url: string) => ReturnType<typeof reply>) =>
  Layer.merge(
    stubRemote((call) => respond(call.url)),
    platform,
  )

describe("the doctor on agents", () => {
  test("says each agent's model, runs, tokens and spend, and how many recent runs Langfuse has and failed", () =>
    run(
      agentsFindings({ langfuse }, ranges([{ gen_ai_response_model: "claude-sonnet" }]), [triage], 0).pipe(
        Effect.provide(remote(answer)),
      ),
    ).then((findings) =>
      expect(findings).toEqual([
        { part: "agents", ok: true, says: "triage: claude-sonnet, runs 30/min, tokens 6/h, spent 5 of 1000 a day" },
        { part: "runs", ok: true, says: "triage: 1 recent, 1 failed" },
      ]),
    ))

  test("says what is missing: a model query's labels, a metrics source, Langfuse, or traces by the name", () =>
    Promise.all([
      run(
        agentsFindings({}, ranges([]), [untold, { ...untold, name: "bare", usage: {} }], 0).pipe(
          Effect.provide(remote(answer)),
        ),
      ),
      run(agentsFindings({}, undefined, [triage], 0).pipe(Effect.provide(remote(answer)))),
      run(
        agentsFindings({ langfuse }, ranges([]), [triage], 0).pipe(
          Effect.provide(remote((url) => (url.includes("/api/public/traces?") ? reply({ data: [] }) : reply("", 500)))),
        ),
      ),
      run(agentsFindings({}, ranges([]), [], 0).pipe(Effect.provide(remote(answer)))),
    ]).then(([untoldModel, noMetrics, noTraces, none]) => {
      expect(untoldModel[0]?.says).toBe(
        "summariser: its model query gave no labels, runs no data/min, tokens no data/h; bare: no model query, runs no data/min, tokens no data/h",
      )
      expect(noMetrics).toEqual([
        { part: "agents", ok: false, says: "no metrics source to read agents' usage from" },
        { part: "runs", ok: false, says: "agents name Langfuse traces, and this environment has no langfuse" },
      ])
      expect(noTraces[1]).toEqual({ part: "runs", ok: true, says: "triage: no traces by its name" })
      expect(none).toEqual([])
    }))

  test("reads a query that fails as no data, as the page does", () =>
    run(
      agentsFindings(
        {},
        { ...ranges([]), range: () => Effect.fail(new SourceFailure({ message: "Prometheus refused" })) },
        [untold],
        0,
      ).pipe(Effect.provide(remote(answer))),
    ).then((findings) => expect(findings[0]?.ok).toBe(true)))
})
