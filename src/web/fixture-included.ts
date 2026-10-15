/** What the server answers when something is included in an incident, or it is summarised (spec 0051), for their tests. */
import type { EvidenceSet } from "../shared/evidence"
import type { Included } from "../shared/included"
import type { SummaryAnswer } from "../shared/summary"

export const includedAs = (what: Included): EvidenceSet => ({
  id: "set-1",
  keptAt: "2026-10-03T12:00:00Z",
  keptBy: "ada lovelace",
  window: { start: 0, end: 60, step: 60 },
  charts: [],
  ...(what.kind === "chart" || what.kind === "trace"
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

export const summarised: SummaryAnswer = {
  what: "Orders slowed after storefront main-88 was deployed, and recovered once it was rolled back.",
  impact: "Checkouts took up to nine seconds for about twenty minutes.",
  cause: "The deploy's new payment client retried too often, per its error lines.",
  turns: [
    { at: "2026-10-03T11:44:00Z", text: "storefront main-88 deployed" },
    { at: "2026-10-03T11:58:00Z", text: "rolled back" },
  ],
  followUps: ["cap the payment client's retries"],
  confidence: "medium",
  model: "claude-haiku-5-5",
  usage: { input: 9000, cached: 6000, output: 400 },
  cost: { amount: 0.02, currency: "USD" },
  readLogs: true,
}
