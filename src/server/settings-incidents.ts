/**
 * `incidents:` in the settings: how far apart two firings may start and still be suggested together (spec 0042), and
 * how far before its first firing an incident's window starts, and how many log lines a service its evidence keeps
 * (spec 0047).
 */
import { Schema } from "effect"
import type { Mistake } from "../shared/shape"
import { notADuration, secondsIn } from "./settings-every"

export const Incidents = Schema.Struct({
  suggestWithin: Schema.optionalKey(Schema.String),
  leadMinutes: Schema.optionalKey(Schema.Number),
  evidence: Schema.optionalKey(Schema.Struct({ lines: Schema.optionalKey(Schema.Number) })),
})
type Incidents = typeof Incidents.Type

const usual = 30

/** The minutes two firings may start apart and still be suggested together: 30 unless set. */
export const suggestWithin = (incidents: Incidents | undefined): number => {
  const seconds = secondsIn(incidents?.suggestWithin ?? "")
  return seconds === undefined ? usual : seconds / 60
}

/** The minutes before its first firing, or its opening if earlier, that an incident's window starts: 30 unless set. */
export const leadMinutes = (incidents: Incidents | undefined): number => incidents?.leadMinutes ?? usual

/** The log lines a service an incident's evidence keeps: 2,000 unless set. */
export const evidenceLines = (incidents: Incidents | undefined): number => incidents?.evidence?.lines ?? 2000

export const incidentsMistakes = (incidents: Incidents | undefined): ReadonlyArray<Mistake> => [
  ...(incidents?.suggestWithin !== undefined && secondsIn(incidents.suggestWithin) === undefined
    ? [{ at: "incidents.suggestWithin", message: notADuration(incidents.suggestWithin) }]
    : []),
  ...(incidents?.leadMinutes !== undefined && !(incidents.leadMinutes >= 0)
    ? [{ at: "incidents.leadMinutes", message: `${incidents.leadMinutes} is not a number of minutes: write 0 or more` }]
    : []),
  ...(incidents?.evidence?.lines !== undefined && !(incidents.evidence.lines >= 1)
    ? [
        {
          at: "incidents.evidence.lines",
          message: `${incidents.evidence.lines} is not a number of lines: write 1 or more`,
        },
      ]
    : []),
]
