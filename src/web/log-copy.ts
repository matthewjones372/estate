/** A service's lines as text to paste or keep: already masked by the server, so nothing here needs hiding. */
import type { LogLine } from "../shared/log-events"

/** A line's level, as its badge reads it. */
export const levelOf = (line: LogLine) => (line.level ?? "").toUpperCase()

/** One line each, its time in full, pod, level and text between tabs, so a spreadsheet splits them. */
export const asText = (lines: ReadonlyArray<LogLine>) =>
  lines.map((line) => [line.at, line.pod ?? "", levelOf(line), line.text].join("\t")).join("\n")

export const fileName = (service: string, environment: string, at: number) =>
  `${service}-${environment}-${new Date(at).toISOString().slice(0, 16).replace(":", "")}.log`

export const copy = (text: string) => navigator.clipboard.writeText(text)

/** Hands the browser a file to keep. */
export const save = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([`${text}\n`], { type: "text/plain" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
