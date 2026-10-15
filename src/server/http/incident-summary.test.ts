import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer, Redacted } from "effect"
import { strFromU8, unzipSync } from "fflate"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import type { SummaryAnswer } from "../../shared/summary"
import { ask, environment, estate, type Server, serverFor, settings } from "../fixture"
import { Notes } from "../notes"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"

const incident = (id: string, title: string): Incident => ({
  id,
  title,
  openedBy: "gil",
  openedAt: "2026-10-12T16:50:00Z",
  firings: [],
  notes: [{ id: "n1", at: "2026-10-12T16:52:00Z", by: "gil", text: "registry container restarted" }],
})
const state = estate({
  environments: { staging: environment(), production: environment() },
  incidents: [incident("i1", "Chip registry slow"), incident("i2", "Adoptions down")],
})
const as = (name: string, role: "operator" | "viewer", ai = true, tokensPerDay?: number): Settings => ({
  ...settings({ anonymous: { name, role }, logs: "operator" }),
  ...(ai
    ? {
        ai: {
          provider: "openai-compatible" as const,
          url: "http://model.test/v1",
          model: "fake-model",
          apiKey: Redacted.make("sk-test"),
          ...(tokensPerDay === undefined ? {} : { budget: { tokensPerDay } }),
        },
      }
    : {}),
})

const summary = {
  what: "The chip registry slowed, adoptions failed, and the registry was restarted.",
  impact: "Adoptions failed for about ten minutes.",
  cause: "The registry ran out of memory, per its restart.",
  turns: [{ at: "2026-10-12T16:52:00Z", text: "registry restarted" }],
  followUps: ["raise the registry's memory limit"],
  confidence: "medium",
}
/** The model as a stub: answers the summary, and keeps every brief it was sent. */
const briefs: Array<string> = []
const model = (call: Call): Reply | undefined => {
  if (!call.url.includes("/chat/completions")) return undefined
  briefs.push(JSON.parse(call.body ?? "{}").messages.at(-1).content)
  return reply({ choices: [{ message: { content: JSON.stringify(summary) } }], usage: { total_tokens: 400 } })
}

const post = (path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const line = { at: "2026-10-12T16:51:00Z", pod: "registry-1", level: "error", text: "out of memory" }
const lines = { kind: "lines", environment: "staging", service: "orders", lines: [line], why: "the cause" }
const summarising = (server: Server, id = "i1") =>
  Effect.map(ask(server, post(`/api/incidents/${id}/summary`)), (answer) => [answer.status, answer.json()] as const)

describe("summarising an incident", () => {
  test("asks the model with the incident's record and what was included, and answers in the summary's shape", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        briefs.length = 0
        const server = yield* serverFor(as("gil", "operator"), state, model)
        yield* ask(server, post("/api/incidents/i1/included", lines))
        const answer = yield* summarising(server)
        const record = (yield* ask(server, new Request("http://estate/api/incidents/i1"))).json() as IncidentRecord
        return { answer, record }
      }),
    ).then(({ answer: [status, body], record }) => {
      expect(status).toBe(200)
      expect(body).toEqual({ ...summary, model: "fake-model", usage: expect.any(Object), readLogs: true })
      expect(briefs[0]).toContain("Chip registry slow")
      expect(briefs[0]).toContain("registry container restarted")
      expect(briefs[0]).toContain("out of memory")
      expect(briefs[0]).toContain('Included by gil: "the cause"')
      const kinds = record.events.filter((each) => each.kind.startsWith("ai-")).map((each) => [each.kind, each.text])
      expect(kinds).toEqual([
        ["ai-asked", "summarise (fake-model)"],
        ["ai-answered", `${summary.what} (medium)`],
      ])
    }))

  test("shares an answer within the minute, and spends from the day's tokens that Ask AI spends from", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        briefs.length = 0
        const server = yield* serverFor(as("gil", "operator", true, 300), state, model)
        const first = yield* summarising(server)
        const again = yield* summarising(server)
        const other = yield* summarising(server, "i2")
        return [first[0], again[0], other]
      }),
    ).then(([first, again, other]) => {
      expect([first, again]).toEqual([200, 200])
      expect(briefs).toHaveLength(1)
      expect(other).toEqual([429, { message: "Ask AI has used today's 300 tokens" }])
    }))

  test("leaves logs out of the brief of someone who may not read them, and the answer says so", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        briefs.length = 0
        const gil = yield* serverFor(as("gil", "operator"), state, model)
        yield* ask(gil, post("/api/incidents/i1/included", lines))
        const shared = Layer.succeed(Notes)(Context.get(gil.context, Notes))
        const vi = yield* serverFor(as("vi", "viewer"), state, model, shared)
        return yield* summarising(vi)
      }),
    ).then(([status, body]) => {
      expect(status).toBe(200)
      expect((body as SummaryAnswer).readLogs).toBe(false)
      expect(briefs[0]).not.toContain("out of memory")
    }))

  test("is not offered where no model is set", () =>
    Effect.runPromise(Effect.flatMap(serverFor(as("gil", "operator", false), state, model), summarising)).then(
      (answer) => {
        expect(answer).toEqual([404, { message: "Ask AI is not configured" }])
      },
    ))

  test("says why when the model fails, keeps that as an event, and can be asked again at once", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const failing = (call: Call): Reply | undefined =>
          call.url.includes("/chat/completions") ? reply({ error: { message: "overloaded" } }, 529) : undefined
        const server = yield* serverFor(as("gil", "operator"), state, failing)
        const first = yield* summarising(server)
        const again = yield* summarising(server)
        const record = (yield* ask(server, new Request("http://estate/api/incidents/i1"))).json() as IncidentRecord
        return { first, again, failed: record.events.filter((each) => each.kind === "ai-failed").length }
      }),
    ).then(({ first, again, failed }) => {
      expect(first).toEqual([502, { message: "the model answered 529: overloaded" }])
      expect(again[0]).toBe(502)
      expect(failed).toBe(2)
    }))

  test("kept as a note, it heads the export's account, and the timeline says it was kept", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("gil", "operator"), state, model)
        yield* ask(server, post("/api/incidents/i1/notes", { text: "an earlier note" }))
        yield* ask(server, post("/api/incidents/i1/notes", { text: "Summary: the registry slowed.", from: "summary" }))
        const zip = yield* Effect.promise(() =>
          server.handler(new Request("http://estate/api/incidents/i1/export?format=zip")),
        )
        const files = unzipSync(new Uint8Array(yield* Effect.promise(() => zip.arrayBuffer())))
        const markdown = Object.entries(files).find(([path]) => path.endsWith("/incident.md"))?.[1]
        const record = (yield* ask(server, new Request("http://estate/api/incidents/i1"))).json() as IncidentRecord
        return { markdown: strFromU8(markdown ?? new Uint8Array()), record }
      }),
    ).then(({ markdown, record }) => {
      expect(markdown.split("\n").slice(0, 5)).toEqual([
        "# Chip registry slow",
        "",
        "## Summary",
        "",
        "Summary: the registry slowed.",
      ])
      expect(record.events.filter((each) => each.kind === "ai-kept")).toEqual([
        expect.objectContaining({ by: "gil", text: "the summary" }),
      ])
    }))
})
