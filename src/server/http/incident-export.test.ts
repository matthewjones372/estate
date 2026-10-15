import { describe, expect, test } from "bun:test"
import { Effect, Option, Schema } from "effect"
import { strFromU8, unzipSync } from "fflate"
import type { Incident } from "../../shared/incidents"
import { IncidentRecord } from "../../shared/incidents"
import { ask, catalog, environment, estate, serverFor, settings } from "../fixture"
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
  journeys: [
    {
      name: "order",
      environments: ["staging"],
      start: { service: "orders", span: "place order" },
      stages: [{ title: "Taken", where: "orders", span: "place order" }],
    },
  ],
}
const firing = estate({
  catalog: measured,
  environments: { staging: environment({ alerts: { state: "ok", value: [slow] } }) },
})
const operator: Settings = {
  ...settings({ anonymous: { name: "gil", role: "operator" } }),
  sources: {
    staging: {
      prometheus: { url: "http://prometheus/" },
      loki: { url: "http://loki/" },
      tempo: { url: "http://tempo/" },
    },
    production: {},
  },
}

const spanAt = (millis: number) => String((Date.parse("2026-10-12T16:50:00Z") + millis) * 1e6)
/** Prometheus, Loki and Tempo as stubs: a series, two lines, and one trace. */
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
            values: [
              [spanAt(0), "ERROR pool exhausted"],
              [spanAt(60_000), "INFO recovered"],
            ],
          },
        ],
      },
    })
  if (url.pathname === "/api/search") return reply({ traces: [{ traceID: "t1" }] })
  if (url.pathname === "/api/traces/t1")
    return reply({
      batches: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "orders" } }] },
          scopeSpans: [
            {
              spans: [{ spanId: "a", name: "place order", startTimeUnixNano: spanAt(0), endTimeUnixNano: spanAt(90) }],
            },
          ],
        },
      ],
    })
  return undefined
}

const sending = (method: string, path: string, body?: unknown) =>
  new Request(`http://estate${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const decodeRecord = Schema.decodeUnknownOption(IncidentRecord)

/** An incident opened on the orders firing, written on, closed, and exported as a zip; then read again. */
const exported = Effect.gen(function* () {
  const server = yield* serverFor(operator, firing, sources)
  const incident = (yield* ask(
    server,
    sending("POST", "/api/incidents", { title: "Chip registry slow", environment: "staging", alert: "a1" }),
  )).json() as Incident
  yield* ask(server, sending("POST", `/api/incidents/${incident.id}/happened`, { text: "Rolled back, by hand" }))
  yield* ask(server, sending("POST", `/api/incidents/${incident.id}/close`, { how: "resized the pool" }))
  const zip = yield* Effect.promise(() =>
    server.handler(sending("GET", `/api/incidents/${incident.id}/export?format=zip`)),
  )
  const bytes = new Uint8Array(yield* Effect.promise(() => zip.arrayBuffer()))
  const after = (yield* ask(server, sending("GET", `/api/incidents/${incident.id}`))).json() as IncidentRecord
  return { zip, files: unzipSync(bytes), after }
})

describe("an incident's export as a zip", () => {
  test("holds its record, timeline, versions, charts, logs, traces and a manifest, under a folder of its name", () =>
    Effect.runPromise(exported).then(({ zip, files }) => {
      expect(zip.headers.get("content-type")).toBe("application/zip")
      expect(zip.headers.get("content-disposition")).toBe('attachment; filename="Chip-registry-slow-2026-10-12.zip"')
      expect(Object.keys(files).sort()).toEqual(
        [
          "incident.md",
          "incident.json",
          "timeline.csv",
          "timeline.jsonl",
          "versions.json",
          "charts/orders-requests.svg",
          "charts/orders-requests.json",
          "logs/orders.log",
          "logs/orders-errors.json",
          "traces/t1.json",
          "manifest.json",
        ]
          .map((path) => `Chip-registry-slow-2026-10-12/${path}`)
          .sort(),
      )
    }))

  test("writes incident.json in the shared schema, and a CSV row an event", () =>
    Effect.runPromise(exported).then(({ files }) => {
      const read = (path: string) => strFromU8(files[`Chip-registry-slow-2026-10-12/${path}`] ?? new Uint8Array())
      const record = decodeRecord(JSON.parse(read("incident.json")))
      expect(Option.isSome(record)).toBe(true)
      const events = Option.match(record, { onNone: () => [], onSome: (each) => each.events })
      const rows = read("timeline.csv").trimEnd().split("\n")
      expect(rows[0]).toBe("at,recordedAt,source,who,kind,service,firing,text,link")
      expect(rows).toHaveLength(events.length + 1)
      expect(rows.some((row) => row.includes(',written,gil,happened,,,"Rolled back, by hand",'))).toBe(true)
      expect(read("timeline.jsonl").trimEnd().split("\n")).toHaveLength(events.length)
      expect(read("logs/orders.log")).toContain("\torders-1\tERROR\tERROR pool exhausted")
      expect(JSON.parse(read("traces/t1.json")).resourceSpans[0].scopeSpans[0].spans[0].name).toBe("place order")
      expect(JSON.parse(read("manifest.json"))).toMatchObject({ live: false, keptBy: "Estate" })
      expect(read("incident.md")).toContain("](charts/orders-requests.svg)")
    }))

  test("draws each chart with the incident's window shaded and its events marked, and is itself an event", () =>
    Effect.runPromise(exported).then(({ files, after }) => {
      const svg = strFromU8(files["Chip-registry-slow-2026-10-12/charts/orders-requests.svg"] ?? new Uint8Array())
      expect(svg).toStartWith("<svg")
      expect(svg).toContain('class="window"')
      expect(svg).toContain('class="event"')
      expect(after.events.filter((each) => each.kind === "exported").map((each) => [each.by, each.text])).toEqual([
        ["gil", "exported as zip"],
      ])
    }))
})
