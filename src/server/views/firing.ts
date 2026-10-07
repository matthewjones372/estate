/** One past firing of an alert, from the firings Estate keeps, with the notes written while it fired. */

import { Duration } from "effect"
import { compact } from "../../shared/compact"
import type { PastFiring } from "../../shared/firing"
import type { EstateState, StoredFiring } from "../state"
import { before, iso } from "../time"
import { impactOf } from "./alerts"
import { changesOf, neighboursOf } from "./around"

/** What changed in the hour before it fired, which deploys it may have followed are no longer held, and its neighbours. */
const aroundThen = (estate: EstateState, firing: StoredFiring) => {
  const subject = firing.service ?? firing.store
  if (subject === undefined) return undefined
  const neighbours = neighboursOf(estate, subject)
  const services = [
    ...(firing.service === undefined ? [] : [firing.service]),
    ...neighbours.filter((each) => each.kind === "service").map((each) => each.name),
  ]
  const deploys = estate.environments[firing.environment]?.deploys.value ?? {}
  return {
    changed: changesOf(
      estate,
      firing.environment,
      services,
      iso(before(Date.parse(firing.startsAt), Duration.hours(1))),
      firing.startsAt,
    ),
    unseen: services.flatMap((service) => {
      const held = deploys[service]
      return held?.at !== undefined && held.at > firing.startsAt ? [{ service, version: held.version }] : []
    }),
    neighbours,
  }
}

/**
 * The firing of alert `id` in `environment` that started at `at`, however the time is written, or its latest when `at`
 * is not said; none once swept.
 */
export const pastFiring = (
  estate: EstateState,
  environment: string,
  id: string,
  at?: string,
): PastFiring | undefined => {
  const all = (estate.firings ?? [])
    .filter((firing) => firing.environment === environment && firing.alert === id)
    .toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))
  const index = at === undefined ? 0 : all.findIndex((firing) => Date.parse(firing.startsAt) === Date.parse(at))
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
    around: aroundThen(estate, firing),
    others: all.filter((each) => each !== firing).map((each) => each.startsAt),
  })
}
