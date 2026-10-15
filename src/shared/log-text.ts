/** A service's lines as text to paste or keep, as the Logs panel's *Save* writes them and an incident's export does. */
import type { LogLine } from "./log-events"

/** A line's level, as its badge reads it. */
export const levelOf = (line: LogLine) => (line.level ?? "").toUpperCase()

/** One line each, its time in full, pod, level and text between tabs, so a spreadsheet splits them. */
export const asText = (lines: ReadonlyArray<LogLine>) =>
  lines.map((line) => [line.at, line.pod ?? "", levelOf(line), line.text].join("\t")).join("\n")
