/** One past firing of an alert, from the firings Estate keeps, with the notes written while it fired. */
import { compact } from "../../shared/compact"
import type { PastFiring } from "../../shared/firing"
import type { EstateState } from "../state"
import { impactOf } from "./alerts"

/** The firing of alert `id` in `environment` that started at `at`, however the time is written; none once swept. */
export const pastFiring = (
  estate: EstateState,
  environment: string,
  id: string,
  at: string,
): PastFiring | undefined => {
  const all = (estate.firings ?? [])
    .filter((firing) => firing.environment === environment && firing.alert === id)
    .toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))
  const index = all.findIndex((firing) => Date.parse(firing.startsAt) === Date.parse(at))
  const firing = all[index]
  if (firing === undefined) return undefined
  // A firing kept without its end owns the notes until the next one began.
  const until = firing.endsAt ?? all[index - 1]?.startsAt
  const notes = estate.notes
    .filter(
      (note) =>
        note.environment === environment &&
        note.alert === id &&
        note.at >= firing.startsAt &&
        (until === undefined || note.at < until),
    )
    .map(({ id, at, by, text }) => ({ id, at, by, text }))
    .sort((a, b) => b.at.localeCompare(a.at))
  return compact({
    ...firing,
    notes,
    impact: impactOf(estate, firing.name),
    others: all.filter((each) => each !== firing).map((each) => each.startsAt),
  })
}
