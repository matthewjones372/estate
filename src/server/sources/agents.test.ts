import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Agent } from "../../shared/catalog"
import { catalog, environment } from "../fixture"
import { reply, stubRemote } from "../remote"
import { agentUsageOf, modelOf, withModels } from "./agents"
import { readMetrics } from "./metrics"
import { prometheusRanges, type Ranges } from "./prometheus"
import { SourceFailure } from "./run"

const triage: Agent = {
  name: "support-triage",
  environments: ["production"],
  usage: {
    runs: "runs",
    errors: "errors",
    tokens: "tokens",
    spent: "spent",
    model: "group by (gen_ai_response_model) (tokens)",
  },
}
const series = (now: number) => ({ now, points: [now] })

/** A metrics source answering each query with a number of its own, and the model as a label. */
const fake = (
  models: ReadonlyArray<Record<string, string>> | "fails" = [{ gen_ai_response_model: "claude-b" }],
): Ranges => ({
  range: (query) =>
    query === "errors"
      ? Effect.fail(new SourceFailure({ message: "no such metric" }))
      : Effect.succeed(series(query.length)),
  rules: Effect.succeed(new Map()),
  labels: () => (models === "fails" ? Effect.fail(new SourceFailure({ message: "down" })) : Effect.succeed(models)),
})

const { labels: _, ...unlabelled } = fake()
const { usage: __, ...bare } = triage

describe("an agent's usage", () => {
  test("is each query it names over the last hour, what it spent, and its model; a failing query is empty", () =>
    Effect.runPromise(agentUsageOf(fake(), triage, 0).pipe(Effect.provide(stubRemote(() => undefined)))).then((usage) =>
      expect(usage).toEqual({
        runs: series(4),
        errors: { now: null, points: [] },
        tokens: series(6),
        spent: 5,
        model: "claude-b",
      }),
    ))

  test("has no model where the source cannot say one, and nothing it does not name", () =>
    Effect.runPromise(
      Effect.all([
        agentUsageOf(unlabelled, triage, 0),
        agentUsageOf(fake("fails"), triage, 0),
        agentUsageOf(fake(), bare, 0),
        readMetrics(fake(), catalog, [], [], [], 0, [triage]),
      ]).pipe(Effect.provide(stubRemote(() => undefined))),
    ).then(([unsaid, failing, bare, metrics]) => {
      expect([unsaid.model, failing.model]).toEqual([undefined, undefined])
      expect(bare).toEqual({})
      expect(metrics.agents?.["support-triage"]?.model).toBe("claude-b")
    }))

  test("names several models by each, and reads Prometheus's labels from an instant query", () => {
    expect(modelOf([{ __name__: "x", model: "b" }, { model: "a" }, { model: "b" }])).toBe("a, b")
    expect(modelOf([])).toBeUndefined()
    const ranges = prometheusRanges({ url: "http://prometheus", headers: {} })
    const answer = (url: string) =>
      url.startsWith("http://prometheus/api/v1/query?")
        ? reply({ data: { result: [{ metric: { gen_ai_response_model: "claude-a" } }] } })
        : undefined
    return Effect.runPromise(
      (ranges.labels?.("group by (gen_ai_response_model) (x)") ?? Effect.succeed([])).pipe(
        Effect.provide(stubRemote((call) => answer(call.url))),
      ),
    ).then((labels) => expect(labels).toEqual([{ gen_ai_response_model: "claude-a" }]))
  })
})

describe("an agent's model", () => {
  const read = (model: string | undefined, since?: string) =>
    environment({
      metrics: {
        state: "ok",
        value: {
          services: {},
          vitals: [],
          edges: [],
          charts: {},
          agents: {
            "support-triage": {
              ...(model === undefined ? {} : { model }),
              ...(since === undefined ? {} : { modelSince: since, modelWas: "claude-a" }),
            },
          },
        },
      },
    })
  const metricsOf = (state: ReturnType<typeof read>) =>
    state.metrics.value ?? { services: {}, vitals: [], edges: [], charts: {} }

  test("changing is kept, with when and from what, and carried on until it changes again", () => {
    const changed = withModels(read("claude-a"), read("claude-b"), metricsOf(read("claude-b")), "t1")
    expect(changed.metrics.value?.agents?.["support-triage"]).toEqual({
      model: "claude-b",
      modelSince: "t1",
      modelWas: "claude-a",
    })
    const carried = withModels(changed, read("claude-b"), metricsOf(read("claude-b")), "t2")
    expect(carried.metrics.value?.agents?.["support-triage"]?.modelSince).toBe("t1")
    expect(
      withModels(read(undefined), read("claude-b"), metricsOf(read("claude-b")), "t3").metrics.value?.agents?.[
        "support-triage"
      ],
    ).toEqual({ model: "claude-b" })
    const unread = environment()
    expect(withModels(read("claude-a"), unread, metricsOf(read("claude-b")), "t4")).toBe(unread)
  })
})
