/**
 * Everything kept of an incident, as the files of its zip (spec 0047): its record and timeline as Markdown, JSON, CSV
 * and JSON lines; what changed; its last kept evidence as charts (SVG and their series), logs and traces; and a
 * manifest of where each came from and what was left out. Each file is under a folder named for the incident.
 */
import type { EvidenceSet, KeptChart, KeptTrace } from "../../shared/evidence"
import type { IncidentRecord } from "../../shared/incidents"
import { asText } from "../../shared/log-text"
import type { TimelineExport } from "../../shared/timeline-export"
import { estateVersion } from "../version"
import { chartSvg } from "./chart-svg"
import { markdownOf } from "./timeline-markdown"

export interface Exporting {
  readonly timeline: TimelineExport
  readonly record: IncidentRecord
  /** Whether this reader may read logs here: if not, the logs and traces are left out, and the manifest says so. */
  readonly readsLogs: boolean
  readonly catalog: string
  /** Its evidence was read from the sources as it was exported, none having been kept. */
  readonly live: boolean
}

const safe = (name: string) => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "incident"

/** "Chip-registry-slow-2026-10-12": its title made safe for a file, and the day it began. */
export const folderOf = (record: IncidentRecord) => {
  const { incident } = record
  const began = Math.min(Date.parse(incident.openedAt), ...incident.firings.map((each) => Date.parse(each.startsAt)))
  return `${safe(incident.title)}-${new Date(began).toISOString().slice(0, 10)}`
}

const csvCell = (value: string | undefined) => {
  const text = value ?? ""
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const csvOf = (timeline: TimelineExport) =>
  [
    "at,recordedAt,source,who,kind,service,firing,text,link",
    ...timeline.events.map((event) =>
      [
        event.at,
        event.recordedAt,
        event.source,
        event.by,
        event.kind,
        event.service,
        event.alert,
        event.text,
        event.link,
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n")

const kinds = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 } as const

/** Milliseconds as OTLP's nanoseconds, written out so they keep their digits. */
const nanos = (millis: number) => `${Math.floor(millis)}${String(Math.round((millis % 1) * 1e6)).padStart(6, "0")}`

/**
 * An id as OTLP JSON writes it, hex of `bytes` bytes: Tempo gives span ids in base64, and trace ids in hex without
 * their leading zeros.
 */
const hexOf = (id: string, bytes: number) =>
  (/^[0-9a-f]+$/i.test(id) ? id.toLowerCase() : Buffer.from(id, "base64").toString("hex")).padStart(bytes * 2, "0")

/** A kept trace as OTLP JSON, a resource a service, so it opens in Tempo or Jaeger again. */
const otlpOf = (trace: KeptTrace) => ({
  resourceSpans: [...new Set(trace.spans.map((span) => span.service))].map((service) => ({
    resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
    scopeSpans: [
      {
        spans: trace.spans
          .filter((span) => span.service === service)
          .map((span) => ({
            traceId: hexOf(trace.id, 16),
            spanId: hexOf(span.id, 8),
            ...(span.parent === undefined ? {} : { parentSpanId: hexOf(span.parent, 8) }),
            name: span.name,
            kind: kinds[span.kind],
            startTimeUnixNano: nanos(span.start),
            endTimeUnixNano: nanos(span.end),
            status: { code: span.failed ? 2 : 0 },
          })),
      },
    ],
  })),
})

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const chartName = (chart: KeptChart, environments: number) =>
  safe([chart.service, chart.panel, ...(environments > 1 ? [chart.environment] : [])].join("-"))

/** The evidence's files: each chart drawn and its series, each service's lines and errors, each trace. */
const evidenceFiles = (record: IncidentRecord, set: EvidenceSet): ReadonlyArray<readonly [string, string]> => {
  const { incident } = record
  const began = Math.min(Date.parse(incident.openedAt), ...incident.firings.map((each) => Date.parse(each.startsAt)))
  const shaded = {
    from: began,
    to: incident.closedAt === undefined ? set.window.end * 1000 : Date.parse(incident.closedAt),
  }
  const marks = record.events.map((event) => Date.parse(event.at))
  const environments = new Set(set.charts.map((chart) => chart.environment)).size
  return [
    ...set.charts.flatMap((chart) => [
      [`charts/${chartName(chart, environments)}.svg`, chartSvg(chart, set.window, shaded, marks)] as const,
      [`charts/${chartName(chart, environments)}.json`, json({ ...chart, window: set.window })] as const,
    ]),
    ...(set.logs ?? []).flatMap((logs) => [
      [`logs/${safe(logs.service)}.log`, `${asText(logs.lines)}\n`] as const,
      [`logs/${safe(logs.service)}-errors.json`, json(logs.errors)] as const,
    ]),
    ...(set.traces ?? []).map((trace) => [`traces/${hexOf(trace.id, 16)}.json`, json(otlpOf(trace))] as const),
  ]
}

const whatChanged = (record: IncidentRecord) => [
  "",
  "## What changed",
  "",
  "| Service | Where | At start | During | At close |",
  "| --- | --- | --- | --- | --- |",
  ...(record.versions ?? []).map((row) =>
    row.environment === undefined
      ? `| ${row.service} | | no version is known for it | | |`
      : `| ${row.service} | ${row.environment} | ${row.start ?? "not known here"} | ${
          row.changes.map((each) => `${each.to} at ${each.at}${each.rolledBack ? ", rolled back" : ""}`).join("; ") ||
          "-"
        } | ${row.close ?? "-"}${row.compare === undefined ? "" : ` ([compare](${row.compare}))`} |`,
  ),
]

const withoutLogs = ({ logs: _, traces: __, ...set }: EvidenceSet): EvidenceSet => set

/** Each file of the zip, by its path under the incident's folder, and its text. */
export const incidentZip = (exporting: Exporting): ReadonlyArray<readonly [string, string]> => {
  const { record, timeline } = exporting
  const kept = record.evidence?.at(-1)
  const set = kept === undefined || exporting.readsLogs ? kept : withoutLogs(kept)
  const evidence = set === undefined ? [] : evidenceFiles(record, set)
  const leftOut = [
    ...(set?.leftOut ?? []),
    ...(kept === undefined ? ["evidence: none has been kept for it yet"] : []),
    ...(exporting.readsLogs ? [] : ["logs and traces: they are for operators here"]),
  ]
  const tables = [
    "incident.json",
    "timeline.csv",
    "timeline.jsonl",
    "versions.json",
    ...evidence.map(([path]) => path),
    "manifest.json",
  ]
  const files: ReadonlyArray<readonly [string, string]> = [
    [
      "incident.md",
      markdownOf(timeline, true, [
        ...whatChanged(record),
        "",
        "## Files",
        "",
        ...tables.map((path) => `- [${path}](${path})`),
      ]),
    ],
    ["incident.json", json({ ...record, evidence: set === undefined ? [] : [set] })],
    ["timeline.csv", `${csvOf(timeline)}\n`],
    ["timeline.jsonl", `${timeline.events.map((event) => JSON.stringify(event)).join("\n")}\n`],
    ["versions.json", json(record.versions ?? [])],
    ...evidence,
  ]
  const manifest = {
    estate: estateVersion,
    catalog: exporting.catalog,
    window: record.window,
    live: exporting.live,
    ...(set === undefined ? {} : { keptBy: set.keptBy, keptAt: set.keptAt }),
    sources: [
      ...(set?.charts ?? []).map((chart) => ({ source: "metrics", asked: chart.query })),
      ...(set?.logs ?? []).map((logs) => ({
        source: logs.from,
        asked: `the lines of ${logs.service} in ${logs.environment}`,
      })),
      ...(set?.traces ?? []).map((trace) => ({ source: "Tempo", asked: `trace ${trace.id}` })),
    ],
    leftOut,
    files: files.map(([path, text]) => ({ path, bytes: new TextEncoder().encode(text).length })),
  }
  const folder = folderOf(record)
  return [...files, ["manifest.json", json(manifest)] as const].map(
    ([path, text]) => [`${folder}/${path}`, text] as const,
  )
}
