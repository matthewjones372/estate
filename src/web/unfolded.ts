/**
 * How an open incident unfolded (spec 0068): its firing alerts as they fired and the notes written on it, oldest
 * first, each note once however many of its alerts carry it.
 */
import type { Alert } from "../shared/events"

export type Told =
  | { readonly kind: "fired"; readonly at: string; readonly alert: Alert }
  | { readonly kind: "note"; readonly at: string; readonly id: string; readonly by: string; readonly text: string }

export const unfoldedOf = (incident: string, alerts: ReadonlyArray<Alert>): ReadonlyArray<Told> => {
  const fired = alerts.map((alert): Told => ({ kind: "fired", at: alert.startsAt, alert }))
  const notes = new Map<string, Told>()
  for (const alert of alerts)
    for (const note of alert.notes)
      if (note.incident?.id === incident && !notes.has(note.id))
        notes.set(note.id, { kind: "note", at: note.at, id: note.id, by: note.by, text: note.text })
  return [...fired, ...notes.values()].toSorted(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || (a.kind === b.kind ? 0 : a.kind === "fired" ? -1 : 1),
  )
}
