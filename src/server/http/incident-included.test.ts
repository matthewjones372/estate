import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { unzipSync } from "fflate"
import type { EvidenceSet } from "../../shared/evidence"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { ask, catalog, environment, estate, type Server, serverFor, settings } from "../fixture"
import { Notes } from "../notes"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"

const load = { requests: "sum(rate(orders_total[1m]))", errors: "sum(rate(orders_errors[1m]))" }
const incident: Incident = {
  id: "i1",
  title: "Orders slow",
  openedBy: "gil",
  openedAt: "2026-10-12T16:50:00Z",
  firings: [],
}
const firing = estate({
  catalog: {
    ...catalog,
    services: catalog.services.map((service) => (service.name === "orders" ? { ...service, load } : service)),
  },
  environments: { staging: environment(), production: environment() },
  incidents: [incident],
})
const sources = { staging: { prometheus: { url: "http://prometheus/" } }, production: {} }
const as = (name: string, role: "operator" | "viewer", more: Partial<Settings> = {}): Settings => {
  const base = settings({ anonymous: { name, role } })
  return { ...base, sources, ...more, auth: { ...base.auth, ...more.auth } }
}

/** Prometheus as a stub: each range answers two points at its end, and keeps the query it was asked. */
const asked: Array<string> = []
const prometheus = (call: Call): Reply | undefined => {
  const url = new URL(call.url)
  if (url.pathname !== "/api/v1/query_range") return undefined
  asked.push(url.searchParams.get("query") ?? "")
  const [end, step] = [Number(url.searchParams.get("end")), Number(url.searchParams.get("step"))]
  return reply({
    data: {
      result: [
        {
          metric: {},
          values: [
            [end - step, "4"],
            [end, "5"],
          ],
        },
      ],
    },
  })
}

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const including = (body: unknown) => sending("POST", "/api/incidents/i1/included", body)
const removing = (set: string) => sending("DELETE", `/api/incidents/i1/included/${set}`)

const line = { at: "2026-10-12T16:48:00Z", pod: "orders-1", level: "error", text: "payment provider timed out" }
const chart = {
  kind: "chart",
  environment: "staging",
  service: "orders",
  panel: "errors",
  from: "2026-10-12T16:00:00Z",
  to: "2026-10-12T17:00:00Z",
  why: "errors start here",
}
const lines = { kind: "lines", environment: "staging", service: "orders", lines: [line] }
const group = {
  shape: "payment provider timed out",
  count: 14,
  firstSeen: "2026-10-12T16:40:00Z",
  lastSeen: "2026-10-12T16:58:00Z",
  pods: ["orders-1"],
  examples: [line],
}
const errors = { kind: "errors", environment: "staging", service: "orders", group }

/** Each request sent in turn to `server`, answered with its status and body. */
const sent = (server: Server, requests: ReadonlyArray<Request>) =>
  Effect.forEach(requests, (request) =>
    Effect.map(ask(server, request), (answer) => [answer.status, answer.json()] as const),
  )
const recordOf = (server: Server) =>
  Effect.map(ask(server, sending("GET", "/api/incidents/i1")), (answer) => answer.json() as IncidentRecord)

describe("including something in an incident", () => {
  test("a chart is read again from the catalog's query over the range asked, and kept with who and why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("gil", "operator"), firing, prometheus)
        const [answer] = yield* sent(server, [including(chart)])
        return { answer, record: yield* recordOf(server) }
      }),
    ).then(({ answer, record }) => {
      const kept = answer?.[1] as EvidenceSet
      expect(answer?.[0]).toBe(201)
      expect(kept).toMatchObject({ from: "included", keptBy: "gil", why: "errors start here" })
      expect(kept.charts).toEqual([expect.objectContaining({ service: "orders", panel: "errors", query: load.errors })])
      expect(kept.charts[0]?.points.slice(-2)).toEqual([4, 5])
      expect(kept.window.end - kept.window.start).toBe(3600)
      expect(asked).toContain(load.errors)
      expect(record.evidence?.map((each) => each.id)).toEqual([kept.id])
      expect(record.events.find((each) => each.kind === "included")?.text).toBe(
        'included orders errors, 12 Oct 16:00 to 17:00 UTC: "errors start here"',
      )
    }))

  test("picked lines and an error group are kept as they were shown", () =>
    Effect.runPromise(
      Effect.flatMap(serverFor(as("gil", "operator"), firing, prometheus), (server) =>
        sent(server, [including(lines), including(errors)]),
      ),
    ).then(([fromLines, fromErrors]) => {
      const [linesSet, errorsSet] = [fromLines?.[1], fromErrors?.[1]] as [EvidenceSet, EvidenceSet]
      expect([fromLines?.[0], fromErrors?.[0]]).toEqual([201, 201])
      expect(linesSet.logs).toEqual([
        { service: "orders", environment: "staging", from: "included", errors: [], lines: [line], leftOut: 0 },
      ])
      expect(errorsSet.logs?.[0]?.errors).toEqual([group])
    }))

  test("is refused a chart the service does not have, and more than 500 lines at once", () =>
    Effect.runPromise(
      Effect.flatMap(serverFor(as("gil", "operator"), firing, prometheus), (server) =>
        sent(server, [
          including({ ...chart, panel: "p99" }),
          including({ ...lines, lines: Array.from({ length: 501 }, () => line) }),
        ]),
      ),
    ).then((answers) => {
      expect(answers).toEqual([
        [404, { message: "orders has no chart named p99 in staging" }],
        [400, { message: "at most 500 lines are included at once" }],
      ])
    }))

  test("is refused past the incident's evidence limit, saying how much room is left", () =>
    Effect.runPromise(
      Effect.flatMap(
        serverFor(as("gil", "operator", { incidents: { evidence: { maxMegabytes: 0.001 } } }), firing, prometheus),
        (server) => sent(server, [including({ ...lines, lines: Array.from({ length: 50 }, () => line) })]),
      ),
    ).then(([answer]) => {
      expect(answer?.[0]).toBe(413)
      expect(answer?.[1]).toEqual({
        message: expect.stringMatching(/^it would pass incidents\.evidence\.maxMegabytes: \d+ bytes are left$/),
      })
    }))

  test("lines and errors are refused to someone who may not read logs, and a chart is not", () =>
    Effect.runPromise(
      Effect.flatMap(
        serverFor(as("vi", "viewer", { auth: { ...settings().auth, logs: "operator" } }), firing, prometheus),
        (server) => sent(server, [including(lines), including(errors), including(chart)]),
      ),
    ).then((answers) => {
      expect(answers.map(([status]) => status)).toEqual([403, 403, 201])
    }))

  test("removing one is an event that names it; only whoever included it or an operator may", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const vi = yield* serverFor(as("vi", "viewer"), firing, prometheus)
        const shared = Layer.succeed(Notes)(Context.get(vi.context, Notes))
        const bo = yield* serverFor(as("bo", "viewer"), firing, prometheus, shared)
        const [[, kept]] = (yield* sent(vi, [including(chart)])) as unknown as [[number, EvidenceSet]]
        const answers = [
          ...(yield* sent(bo, [removing(kept.id)])),
          ...(yield* sent(vi, [removing("none"), removing(kept.id), removing(kept.id)])),
        ]
        return { kept, answers, record: yield* recordOf(vi) }
      }),
    ).then(({ kept, answers, record }) => {
      expect(answers.map(([status]) => status)).toEqual([403, 404, 200, 404])
      expect(answers[0]?.[1]).toEqual({ message: "only whoever included it, or an operator, removes it" })
      expect(record.evidence?.map((each) => each.id)).toEqual([kept.id])
      expect(record.events.filter((each) => each.kind === "evidence-removed")).toEqual([
        expect.objectContaining({ by: "vi", link: kept.id, text: "removed orders errors, included by vi" }),
      ])
    }))

  test("is exported in the zip, each item in a folder of its own with why, and what was removed apart", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("gil", "operator"), firing, prometheus)
        const [, [, lined]] = (yield* sent(server, [including(chart), including(lines)])) as unknown as [
          unknown,
          [number, EvidenceSet],
        ]
        yield* sent(server, [removing(lined.id)])
        const zip = yield* Effect.promise(() => server.handler(sending("GET", "/api/incidents/i1/export?format=zip")))
        return Object.keys(unzipSync(new Uint8Array(yield* Effect.promise(() => zip.arrayBuffer()))))
      }),
    ).then((paths) => {
      const inside = paths.map((path) => path.split("/").slice(1).join("/"))
      expect(inside).toContain("included/1/included.json")
      expect(inside).toContain("included/1/charts/orders-errors.svg")
      expect(inside).toContain("removed/1/logs/orders.log")
      expect(inside.filter((path) => path.startsWith("charts/"))).toEqual([])
    }))
})
