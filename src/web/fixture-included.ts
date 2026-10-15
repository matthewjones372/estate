/** What the server answers when something is included in an incident (spec 0051), for the include tests. */
import type { EvidenceSet } from "../shared/evidence"
import type { Included } from "../shared/included"

export const includedAs = (what: Included): EvidenceSet => ({
  id: "set-1",
  keptAt: "2026-10-03T12:00:00Z",
  keptBy: "ada lovelace",
  window: { start: 0, end: 60, step: 60 },
  charts: [],
  ...(what.kind === "chart"
    ? {}
    : {
        logs: [
          {
            service: what.service,
            environment: what.environment,
            from: "included",
            errors: what.kind === "errors" ? [what.group] : [],
            lines: what.kind === "lines" ? what.lines : [],
            leftOut: 0,
          },
        ],
      }),
  from: "included",
  ...(what.why === undefined ? {} : { why: what.why }),
})
