import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { type Call, reply, stubRemote } from "../remote"
import { readAiCosts } from "./ai-costs"

// 6 October 2026, at noon.
const now = Date.UTC(2026, 9, 6, 12)
const day = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000

/** Anthropic's report in cents by workspace, and OpenAI's in dollars by project, from the month's start. */
const providers = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.url.startsWith("https://api.anthropic.com/v1/organizations/cost_report?"))
    return reply({
      data: [
        { starting_at: "2026-10-01T00:00:00Z", results: [{ amount: "1250.5", workspace_id: "wrk_support" }] },
        {
          starting_at: "2026-10-05T00:00:00Z",
          results: [
            { amount: "3100", workspace_id: "wrk_support" },
            { amount: "900", workspace_id: null },
          ],
        },
      ],
    })
  if (call.url.startsWith("https://api.openai.com/v1/organization/costs?"))
    return reply({
      data: [
        {
          start_time: day("2026-10-05"),
          results: [{ amount: { value: 7.25, currency: "usd" }, project_id: "proj_search" }],
        },
      ],
    })
  return undefined
}

const admin = {
  anthropic: { adminKey: Redacted.make("sk-ant-admin") },
  openai: { adminKey: Redacted.make("sk-admin") },
}

describe("the AI providers' cost reports", () => {
  test("give an agent its month to date and yesterday, by its workspace or project, read with an admin key", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      readAiCosts(
        admin,
        [
          {
            name: "support-triage",
            cost: { anthropic: { workspace: "wrk_support" }, budget: { amount: 40, per: "day" } },
          },
          { name: "search-agent", cost: { openai: { project: "proj_search" } } },
        ],
        now,
        "USD",
      ).pipe(Effect.provide(stubRemote(providers(calls)))),
    ).then((costs) => {
      expect(costs).toEqual({
        "support-triage": {
          from: "Anthropic",
          currency: "USD",
          monthToDate: 43.505,
          yesterday: 31,
          budget: { amount: 40, per: "day" },
        },
        "search-agent": { from: "OpenAI", currency: "USD", monthToDate: 7.25, yesterday: 7.25 },
      })
      expect(calls.map((call) => call.headers?.["x-api-key"] ?? call.headers?.["authorization"])).toEqual([
        "sk-ant-admin",
        "Bearer sk-admin",
      ])
      expect(calls[0]?.url).toContain("starting_at=2026-10-01T00:00:00Z")
    })
  })

  test("asks no provider for agents it does not bill, and says why a report could not be read", () => {
    const calls: Call[] = []
    return Promise.all([
      Effect.runPromise(
        readAiCosts({}, [{ name: "x", cost: { anthropic: { workspace: "w" } } }], now, "USD").pipe(
          Effect.provide(stubRemote(providers(calls))),
        ),
      ),
      Effect.runPromise(
        Effect.flip(
          readAiCosts(admin, [{ name: "x", cost: { openai: { project: "p" } } }], now, "USD").pipe(
            Effect.provide(stubRemote(() => reply("no", 401))),
          ),
        ),
      ),
      Effect.runPromise(
        Effect.flip(
          readAiCosts(admin, [{ name: "x", cost: { anthropic: { workspace: "w" } } }], now, "USD").pipe(
            Effect.provide(stubRemote(() => reply({ data: "?" }))),
          ),
        ),
      ),
    ]).then(([none, refused, odd]) => {
      expect([none, calls.length]).toEqual([{}, 0])
      expect(refused.message).toBe("OpenAI's cost report answered 401: no")
      expect(odd.message).toBe("Anthropic's cost report answered in a shape Estate does not know")
    })
  })
})
