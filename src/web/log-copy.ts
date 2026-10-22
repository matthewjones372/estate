/** A service's lines as text to paste or keep: already masked by the server, so nothing here needs hiding. */
import type { LogLine } from "../shared/log-events"
import { asText } from "../shared/log-text"
import { type LogsShown, pathOf } from "./route"

export { asText, levelOf } from "../shared/log-text"

/** Where copied lines are from, as one line: the service, the environment, and its page showing the same logs. */
export const fromWhere = (
  origin: string,
  from: { readonly service: string; readonly environment: string; readonly logs?: LogsShown },
) => {
  const address = new URL(
    pathOf({ page: "service", name: from.service, ...(from.logs === undefined ? {} : { logs: from.logs }) }),
    origin,
  )
  address.searchParams.set("env", from.environment)
  return `${from.service} in ${from.environment} · ${address.href}`
}

/** Lines to paste, below where they are from, so whoever reads the paste can open them (spec 0068). */
export const headed = (
  from: { readonly service: string; readonly environment: string; readonly logs?: LogsShown },
  lines: ReadonlyArray<LogLine>,
) => `${fromWhere(window.location.origin, from)}\n${asText(lines)}`

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
