/** A service's lines as text to paste or keep, as the Logs panel's *Save* writes them and an incident's export does. */
import type { LogLine } from "./log-events"

/** A line's level, as its badge reads it. */
export const levelOf = (line: LogLine) => (line.level ?? "").toUpperCase()

/** Its text without the level it begins with, which has a column of its own. */
const textOf = (line: LogLine) => {
  const level = levelOf(line)
  const said = line.text.match(/^(\S+)\s+/)
  return level !== "" && said?.[1]?.toUpperCase() === level ? line.text.slice(said[0].length) : line.text
}

/** One line each, its time in full, pod, level and text between tabs, so a spreadsheet splits them. */
export const asText = (lines: ReadonlyArray<LogLine>) =>
  lines.map((line) => [line.at, line.pod ?? "", levelOf(line), textOf(line)].join("\t")).join("\n")
