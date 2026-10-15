import { describe, expect, test } from "bun:test"
import { Context, Effect, Layer } from "effect"
import { strFromU8, unzipSync } from "fflate"
import type { Incident, IncidentRecord } from "../../shared/incidents"
import { ask, catalog, environment, estate, type Server, serverFor, settings } from "../fixture"
import { Notes } from "../notes"
import { type Call, type Reply, reply } from "../remote"
import type { Settings } from "../settings"
import type { SourcedAlert } from "../state"

const slow: SourcedAlert = {
  id: "a1",
  name: "OrdersSlow",
  state: "firing",
  severity: "warning",
  startsAt: "2026-10-12T16:47:58Z",
  labels: { alertname: "OrdersSlow", app: "orders" },
}
const measured = {
  ...catalog,
  services: catalog.services.map((service) =>
    service.name === "orders" ? { ...service, load: { requests: "sum(rate(orders_total[1m]))" } } : service,
  ),
}
const firing = estate({
  catalog: measured,
  environments: { staging: environment({ alerts: { state: "ok", value: [slow] } }) },
})
const as = (role: "operator" | "viewer"): Settings => ({
  ...settings({ anonymous: { name: role === "operator" ? "gil" : "vi", role }, logs: "operator" }),
  sources: { staging: { prometheus: { url: "http://prometheus/" }, loki: { url: "http://loki/" } }, production: {} },
})

/** Prometheus and Loki as stubs: a series, and a line. */
const sources = (call: Call): Reply | undefined => {
  const url = new URL(call.url)
  if (url.pathname === "/api/v1/query_range") {
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
  if (url.pathname === "/loki/api/v1/query_range")
    return reply({
      data: {
        result: [
          {
            stream: { pod: "orders-1" },
            values: [[`${Date.parse("2026-10-12T16:50:00Z")}000000`, "ERROR pool exhausted"]],
          },
        ],
      },
    })
  return undefined
}

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const opened = (server: Server) =>
  Effect.map(
    ask(server, sending("POST", "/api/incidents", { title: "Orders slow", environment: "staging", alert: "a1" })),
    (answer) => answer.json() as Incident,
  )

/** The zip `server` gives of incident `id`, as its paths under the folder and their text. */
const zipOf = (server: Server, id: string) =>
  Effect.gen(function* () {
    const zip = yield* Effect.promise(() => server.handler(sending("GET", `/api/incidents/${id}/export?format=zip`)))
    const files = unzipSync(new Uint8Array(yield* Effect.promise(() => zip.arrayBuffer())))
    return Object.fromEntries(
      Object.entries(files).map(([path, bytes]) => [path.split("/").slice(1).join("/"), strFromU8(bytes)]),
    )
  })

describe("an incident's zip, as each reader takes it", () => {
  test("has no logs or traces for a viewer where logs are for operators, and its manifest says why", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("operator"), firing, sources)
        const incident = yield* opened(server)
        const ended = (yield* ask(
          server,
          sending("POST", `/api/incidents/${incident.id}/close`, { how: "resized the pool" }),
        )).json() as Incident
        const shared = Layer.succeed(Notes)(Context.get(server.context, Notes))
        const viewer = yield* serverFor(as("viewer"), { ...firing, incidents: [ended] }, sources, shared)
        return { operator: yield* zipOf(server, incident.id), viewer: yield* zipOf(viewer, incident.id) }
      }),
    ).then(({ operator, viewer }) => {
      expect(Object.keys(operator).some((path) => path.startsWith("logs/"))).toBe(true)
      expect(Object.keys(viewer).filter((path) => path.startsWith("logs/") || path.startsWith("traces/"))).toEqual([])
      expect(Object.keys(viewer)).toContain("charts/orders-requests.svg")
      expect(JSON.parse(viewer["manifest.json"] ?? "{}").leftOut).toContain(
        "logs and traces: they are for operators here",
      )
    }))

  test("reads the sources then, before any evidence is kept, says it is live, and keeps nothing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const server = yield* serverFor(as("operator"), firing, sources)
        const incident = yield* opened(server)
        const files = yield* zipOf(server, incident.id)
        const record = (yield* ask(server, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
        return { files, record }
      }),
    ).then(({ files, record }) => {
      expect(JSON.parse(files["manifest.json"] ?? "{}")).toMatchObject({ live: true })
      expect(Object.keys(files)).toContain("charts/orders-requests.svg")
      expect(Object.keys(files)).toContain("logs/orders.log")
      expect(record.evidence).toEqual([])
      expect(record.events.some((each) => each.kind === "evidence-kept")).toBe(false)
    }))
})
