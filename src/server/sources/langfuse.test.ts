import { describe, expect, test } from "bun:test"
import { Effect, Redacted, Result } from "effect"
import { type Call, reply, stubRemote } from "../remote"
import { agentRuns } from "./langfuse"

const langfuse = {
  url: "https://langfuse.example/",
  publicKey: Redacted.make("pk-lf"),
  secretKey: Redacted.make("sk-lf"),
}

/** Langfuse's public API, in the shapes its reference gives: a list of traces, and each trace whole. */
const traces: Readonly<Record<string, unknown>> = {
  t2: {
    id: "t2",
    timestamp: "2026-10-03T11:58:00.000Z",
    htmlPath: "/project/p1/traces/t2",
    latency: 31.2,
    totalCost: 0.041,
    observations: [
      { type: "SPAN", level: "DEFAULT" },
      {
        type: "GENERATION",
        level: "DEFAULT",
        model: "claude-sonnet",
        usage: { input: 9000, output: 1400, total: 10400 },
      },
      {
        type: "GENERATION",
        level: "ERROR",
        statusMessage: "tool search_orders timed out",
        model: "claude-sonnet",
        usage: { total: 2000 },
      },
    ],
  },
  t1: {
    id: "t1",
    timestamp: "2026-10-03T11:55:00.000Z",
    latency: null,
    totalCost: null,
    observations: [{ type: "SPAN", level: "DEFAULT", usage: null }],
  },
}

const fake = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.headers?.["authorization"] !== `Basic ${btoa("pk-lf:sk-lf")}`) return reply({ message: "Unauthorized" }, 401)
  const url = new URL(call.url)
  if (url.pathname === "/api/public/traces") return reply({ data: [{ id: "t2" }, { id: "t1" }], meta: { page: 1 } })
  const id = url.pathname.split("/").at(-1) ?? ""
  return traces[id] === undefined ? reply({ message: "not found" }, 404) : reply(traces[id])
}

describe("an agent's runs in Langfuse", () => {
  test("are its newest traces by name, each failed if a step erred, its tokens its generations', and a link", () => {
    const calls: Call[] = []
    return Effect.runPromise(agentRuns(langfuse, "support-triage").pipe(Effect.provide(stubRemote(fake(calls))))).then(
      (runs) => {
        expect(runs).toEqual([
          {
            id: "t2",
            startedAt: "2026-10-03T11:58:00.000Z",
            failed: true,
            message: "tool search_orders timed out",
            seconds: 31.2,
            tokens: 12_400,
            cost: 0.041,
            model: "claude-sonnet",
            url: "https://langfuse.example/project/p1/traces/t2",
          },
          { id: "t1", startedAt: "2026-10-03T11:55:00.000Z", failed: false },
        ])
        const listed = new URL(calls[0]?.url ?? "")
        expect([
          listed.searchParams.get("name"),
          listed.searchParams.get("limit"),
          listed.searchParams.get("orderBy"),
        ]).toEqual(["support-triage", "10", "timestamp.desc"])
      },
    )
  })

  test("say so in Langfuse's name when it refuses or answers oddly", () =>
    Promise.all([
      Effect.runPromise(
        Effect.result(
          agentRuns({ ...langfuse, secretKey: Redacted.make("wrong") }, "x").pipe(Effect.provide(stubRemote(fake([])))),
        ),
      ),
      Effect.runPromise(
        Effect.result(agentRuns(langfuse, "x").pipe(Effect.provide(stubRemote(() => reply({ data: "?" }))))),
      ),
    ]).then(([refused, odd]) => {
      expect(Result.isFailure(refused) && refused.failure.message).toStartWith("Langfuse answered 401")
      expect(Result.isFailure(odd) && odd.failure.message).toBe("Langfuse answered in a shape Estate does not know")
    }))
})
