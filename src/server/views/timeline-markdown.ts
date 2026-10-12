/**
 * A timeline as Markdown, a review's starting point: the title, each firing, the events as a table, then the notes in
 * full. Every time is UTC to the second, so a review read across zones agrees on the order.
 */
import { onIncident, said } from "../../shared/timeline"
import type { ExportedFiring, TimelineExport } from "../../shared/timeline-export"

/** "2026-10-02T09:00:00Z"; a time that does not parse is left as written rather than lost. */
const utc = (at: string) => {
  const parsed = Date.parse(at)
  return Number.isNaN(parsed) ? at : `${new Date(parsed).toISOString().slice(0, 19)}Z`
}

/** A cell's text on one line, with no pipe to end the cell early. */
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")

const line = (label: string, value: string | undefined) => (value === undefined ? [] : [`- **${label}:** ${value}`])

const about = (firing: ExportedFiring) => [
  ...line("Service", firing.service),
  ...line("Store", firing.store),
  ...line("Environment", firing.environment),
  ...line("Fired", utc(firing.startsAt)),
  ...line(
    "Resolved",
    firing.endsAt === undefined ? (firing.firing ? "still firing" : "its end was not seen") : utc(firing.endsAt),
  ),
  ...line("Severity", firing.severity),
  ...line("Summary", firing.summary),
  ...line("Impact", firing.impact),
]

const incidentLines = (incident: NonNullable<TimelineExport["incident"]>) => [
  ...line("Opened", `by ${incident.openedBy}, ${utc(incident.openedAt)}`),
  ...line(
    "Closed",
    incident.closedAt === undefined
      ? "still open"
      : `by ${incident.closedBy ?? "someone"}, ${utc(incident.closedAt)}: ${incident.ended ?? ""}`,
  ),
  ...line("Incident tool", incident.link),
]

const table = (record: TimelineExport) => {
  const many = record.incident !== undefined
  const head = many ? ["At (UTC)", "Who", "Alert", "What"] : ["At (UTC)", "Who", "What"]
  const rows = record.events.map((event) => {
    const what = event.link === undefined ? said(event) : `${said(event)} (<${event.link}>)`
    const on = onIncident(event) ? "(incident)" : (event.alert ?? "")
    const cells = many ? [utc(event.at), event.by, on, what] : [utc(event.at), event.by, what]
    return `| ${cells.map(cell).join(" | ")} |`
  })
  return rows.length === 0
    ? ["Nothing is kept for it yet."]
    : [`| ${head.join(" | ")} |`, `|${" --- |".repeat(head.length)}`, ...rows]
}

/** Each note as a quote, its lines kept as written. */
const quoted = (notes: ExportedFiring["notes"]) =>
  notes.flatMap((note) => [
    `**${note.by}**, ${utc(note.at)}`,
    "",
    ...note.text.split(/\r?\n/).map((each) => (each === "" ? ">" : `> ${each}`)),
    "",
  ])

const notes = (record: TimelineExport) => {
  const written = record.firings.filter((firing) => firing.notes.length > 0)
  if (record.incident === undefined)
    return written.length === 0 ? ["No notes were kept.", ""] : written.flatMap((firing) => quoted(firing.notes))
  const own = record.incident.notes ?? []
  const sections = [
    ...(own.length === 0 ? [] : ["### On the incident", "", ...quoted(own)]),
    ...written.flatMap((firing) => [`### ${firing.name}, ${firing.environment}`, "", ...quoted(firing.notes)]),
  ]
  return sections.length === 0 ? ["No notes were kept.", ""] : sections
}

export const markdownOf = (record: TimelineExport): string => {
  const head =
    record.incident === undefined
      ? record.firings.flatMap(about)
      : [
          ...incidentLines(record.incident),
          "",
          "## Firings",
          ...record.firings.flatMap((firing) => ["", `### ${firing.name}`, "", ...about(firing)]),
        ]
  return [
    `# ${record.title}`,
    "",
    ...head,
    "",
    "## Timeline",
    "",
    ...table(record),
    "",
    "## Notes",
    "",
    ...notes(record),
  ]
    .join("\n")
    .replace(/\n+$/, "\n")
}

/** "OrdersSlow-2026-10-02T0900Z.md": the name made safe for a file, and when it began to the minute, with no colon. */
export const fileName = (name: string, at: string, extension: "md" | "json") => {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return `${safe === "" ? "timeline" : safe}-${utc(at).slice(0, 16).replace(":", "")}Z.${extension}`
}
