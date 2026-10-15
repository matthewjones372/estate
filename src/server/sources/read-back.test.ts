import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Redacted, Stream, SubscriptionRef } from "effect"
import type { Incident } from "../../shared/incidents"
import { ask, estate, serverFor, settings } from "../fixture"
import { type Call, reply, stubRemote } from "../remote"
import { Estate } from "../state"
import { pagerDuty } from "./pagerduty"
import { readBack } from "./read-back"

const raised = (id: string, tool: string): Incident => ({
  id,
  title: id,
  openedBy: "gil",
  openedAt: "2026-10-12T16:50:00Z",
  firings: [],
  link: `https://example.pagerduty.com/incidents/${tool}`,
  raised: { tool: "PagerDuty", id: tool, by: "gil", at: "2026-10-12T16:51:20Z" },
})

const incidents: ReadonlyArray<Incident> = [
  raised("slow", "Q1"),
  raised("down", "Q2"),
  { ...raised("over", "Q3"), closedAt: "2026-10-12T17:00:00Z", closedBy: "gil", ended: "it passed" },
  { id: "quiet", title: "quiet", openedBy: "gil", openedAt: "2026-10-12T16:50:00Z", firings: [] },
]

/** PagerDuty, answering for Q1 and refusing for Q2 with 503. */
const answer = (calls: Call[]) => (call: Call) => {
  calls.push(call)
  if (call.url.endsWith("/incidents/Q2")) return reply({ error: { message: "Service Unavailable" } }, 503)
  return reply({
    incident: {
      status: "acknowledged",
      urgency: "high",
      priority: { summary: "P2" },
      assignments: [{ assignee: { summary: "ada" } }, { assignee: { summary: "gil" } }],
      html_url: "https://example.pagerduty.com/incidents/Q1",
    },
  })
}

const tool = pagerDuty({ token: Redacted.make("pd"), from: "estate@example.com", service: "PABC123" })

describe("reading back incidents raised in the tool", () => {
  test("reads each open one raised, and a tool that does not answer for one says so for that one alone", () => {
    const calls: Call[] = []
    return Effect.runPromise(
      Effect.gen(function* () {
        const ref = yield* SubscriptionRef.make(estate({ incidents, inTool: { gone: { tool: "PagerDuty" } } }))
        const fiber = yield* Effect.forkChild(
          readBack(tool, "1 hour").pipe(Effect.provideService(Estate, ref), Effect.provide(stubRemote(answer(calls)))),
        )
        const read = yield* SubscriptionRef.changes(ref).pipe(
          Stream.filter((state) => state.inTool?.["gone"] === undefined),
          Stream.runHead,
        )
        yield* Fiber.interrupt(fiber)
        return read._tag === "Some" ? read.value.inTool : undefined
      }),
    ).then((inTool) => {
      expect(inTool).toEqual({
        slow: { tool: "PagerDuty", said: { status: "acknowledged", severity: "P2", responders: ["ada", "gil"] } },
        down: { tool: "PagerDuty", failing: "503: Service Unavailable" },
      })
      expect(calls.map((call) => new URL(call.url).pathname).toSorted()).toEqual(["/incidents/Q1", "/incidents/Q2"])
    })
  })

  test("is read with the incident, by whoever may read it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const said = { status: "acknowledged", severity: "P2", responders: ["ada", "gil"] }
        const inTool = { slow: { tool: "PagerDuty", said } }
        const server = yield* serverFor(
          settings({ anonymous: { name: "vi", role: "viewer" } }),
          estate({ incidents, inTool }),
        )
        const read = (id: string) =>
          Effect.map(ask(server, new Request(`http://estate/api/incidents/${id}`)), (answered) => answered.json())
        return [yield* read("slow"), yield* read("quiet")] as ReadonlyArray<{ readonly inTool?: unknown }>
      }),
    ).then(([slow, quiet]) => {
      expect(slow?.inTool).toEqual({
        tool: "PagerDuty",
        said: { status: "acknowledged", severity: "P2", responders: ["ada", "gil"] },
      })
      expect(quiet?.inTool).toBeUndefined()
    }))
})
