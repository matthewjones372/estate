/** `incidents:` in the settings (spec 0042): how far apart two firings may start and still be suggested together. */
import { Schema } from "effect"
import type { Mistake } from "../shared/shape"
import { notADuration, secondsIn } from "./settings-every"

export const Incidents = Schema.Struct({ suggestWithin: Schema.optionalKey(Schema.String) })
type Incidents = typeof Incidents.Type

const usual = 30

/** The minutes two firings may start apart and still be suggested together: 30 unless set. */
export const suggestWithin = (incidents: Incidents | undefined): number => {
  const seconds = secondsIn(incidents?.suggestWithin ?? "")
  return seconds === undefined ? usual : seconds / 60
}

export const incidentsMistakes = (incidents: Incidents | undefined): ReadonlyArray<Mistake> =>
  incidents?.suggestWithin !== undefined && secondsIn(incidents.suggestWithin) === undefined
    ? [{ at: "incidents.suggestWithin", message: notADuration(incidents.suggestWithin) }]
    : []
