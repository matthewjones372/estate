/** A service's lines and errors as the server sends them, for the logs' tests. */
import type { ErrorGroups, LogBatch } from "../shared/log-events"

const line = (minute: number, level: string, text: string, pod = "storefront-1") => ({
  at: `2026-10-03T11:${String(minute).padStart(2, "0")}:00.000Z`,
  pod,
  level,
  text,
})

export const lines: LogBatch = {
  lines: [line(55, "INFO", "INFO started"), line(56, "ERROR", "ERROR order 41 lost"), line(57, "WARN", "WARN slow")],
  skipped: false,
}

export const groups: ErrorGroups = {
  from: "Loki",
  groups: [
    {
      shape: "ERROR order ‹n› lost",
      count: 2,
      firstSeen: "2026-10-03T11:50:00.000Z",
      lastSeen: "2026-10-03T11:56:00.000Z",
      pods: ["storefront-1"],
      examples: [line(56, "ERROR", "ERROR order 41 lost"), line(50, "ERROR", "ERROR order 7 lost")],
    },
  ],
}
