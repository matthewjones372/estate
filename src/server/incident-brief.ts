/**
 * An incident's brief for Summarise (spec 0051): its record as one reader reads it, as text. What was included and kept
 * is said short: a chart as its first, last, lowest and highest values, lines and errors as text, a trace as its
 * length and its five longest steps. Nothing a reader may not read is in their record, so it is not in their brief.
 */
import { type EvidenceSet, includedIn, type KeptChart, keptByEstate, unitOf } from "../shared/evidence"
import type { IncidentRecord } from "../shared/incidents"
import { measured } from "../shared/measure"
import { said } from "../shared/timeline"
import { tookOf } from "../shared/traces"

const mostLines = 60
const mostEvents = 200

const atOf = (set: EvidenceSet, index: number) =>
  new Date((set.window.start + index * set.window.step) * 1000).toISOString().slice(0, 16)

const chartText = (chart: KeptChart, set: EvidenceSet) => {
  const read = chart.points.flatMap((value, index) => (value === null ? [] : [{ value, index }]))
  const [first, last] = [read[0], read.at(-1)]
  if (first === undefined || last === undefined) return `${chart.service} ${chart.panel}: no points`
  const low = read.reduce((a, b) => (b.value < a.value ? b : a))
  const high = read.reduce((a, b) => (b.value > a.value ? b : a))
  const say = (point: { readonly value: number; readonly index: number }) =>
    `${measured(point.value, unitOf(chart))} at ${atOf(set, point.index)}`
  return `${chart.service} ${chart.panel} in ${chart.environment}: first ${say(first)}, last ${say(last)}, lowest ${say(low)}, highest ${say(high)}`
}

const setText = (set: EvidenceSet) => [
  ...set.charts.map((chart) => `- ${chartText(chart, set)}`),
  ...(set.logs ?? []).flatMap((logs) => [
    ...logs.errors.map((group) => `- ${logs.service} error, ${group.count} times: ${group.shape}`),
    ...logs.lines.slice(-mostLines).map((line) => `- ${logs.service} ${line.at} ${line.level ?? ""} ${line.text}`),
  ]),
  ...(set.traces ?? []).map((trace) => {
    const longest = trace.spans
      .toSorted((a, b) => b.end - b.start - (a.end - a.start))
      .slice(0, 5)
      .map(
        (span) => `${span.service} ${span.name} ${Math.round(span.end - span.start)} ms${span.failed ? " failed" : ""}`,
      )
    return `- trace ${trace.id}, ${Math.round(tookOf(trace))} ms: ${longest.join("; ")}`
  }),
]

/** Whether the brief carries anything read from logs: lines, errors or traces. */
export const briefReadsLogs = (record: IncidentRecord) =>
  (record.evidence ?? []).some((set) => (set.logs ?? []).length > 0 || (set.traces ?? []).length > 0)

export const incidentBrief = (record: IncidentRecord): string => {
  const { incident } = record
  const { shown } = includedIn(record.evidence, record.events)
  const kept = keptByEstate(record.evidence).at(-1)
  return [
    `Incident: ${incident.title}`,
    `Opened by ${incident.openedBy} at ${incident.openedAt}.`,
    incident.closedAt === undefined
      ? "Still open."
      : `Closed by ${incident.closedBy ?? "someone"} at ${incident.closedAt}: ${incident.ended ?? ""}`,
    `Window: ${record.window?.from ?? "?"} to ${record.window?.to ?? "now"}. Services: ${(record.services ?? []).join(", ") || "none"}.`,
    "",
    "Firings:",
    ...incident.firings.map((each) => `- ${each.name ?? each.alert} in ${each.environment}, from ${each.startsAt}`),
    "",
    "What changed:",
    ...(record.versions ?? []).map(
      (row) =>
        `- ${row.service}: ${row.start ?? "not known"} at start, ${row.changes.map((each) => `${each.to} at ${each.at}`).join(", ") || "no change"}, ${row.close ?? "-"} at close`,
    ),
    "",
    "Notes:",
    ...(incident.notes ?? []).map((note) => `- ${note.at} ${note.by}: ${note.text}`),
    "",
    "Timeline:",
    ...record.events.slice(-mostEvents).map((event) => `- ${event.at} ${event.by}: ${said(event)}`),
    "",
    "Included by people:",
    ...shown.flatMap((set) => [
      `Included by ${set.keptBy}${set.why === undefined ? "" : `: "${set.why}"`}`,
      ...setText(set),
    ]),
    "",
    "Kept by Estate:",
    ...(kept === undefined ? ["nothing yet"] : setText(kept)),
  ].join("\n")
}
