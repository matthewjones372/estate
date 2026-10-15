/**
 * Each alert's firings, kept: when it started, who silenced it and why, and when it ended. They are written as Estate
 * sees them happen, compared only once an environment's alerts have answered, so a slow start ends nothing.
 */
import { Clock, Duration, Effect, Stream, SubscriptionRef } from "effect"
import { Notes, type StoredEvent, type StoredFiring, sameFiring } from "./notes"
import { keptBy } from "./notes-sweep"
import { forEver } from "./schedule"
import type { SlackSettings } from "./sources/slack"
import { Estate, type EstateState, updateEstate } from "./state"
import { lasting, replyInThread } from "./threads"
import { before, iso } from "./time"
import { serviceOf } from "./views/health"
import { storeOf, storesIn } from "./views/stores"

// By the start's instant: a store reads a start back written its own way, and it is still the firing that fires.
const keyOf = (firing: Pick<StoredFiring, "environment" | "alert" | "startsAt">) => {
  const at = Date.parse(firing.startsAt)
  return `${firing.environment}\u0000${firing.alert}\u0000${Number.isNaN(at) ? firing.startsAt : at}`
}

/** What fires now in each environment whose alerts have answered, by firing; and those environments. */
export const firingNow = (estate: EstateState) => {
  const answered = new Set<string>()
  const firing = new Map<string, StoredFiring>()
  for (const [environment, state] of Object.entries(estate.environments)) {
    if (state.alerts.state !== "ok") continue
    answered.add(environment)
    const stores = storesIn(estate.catalog, environment)
    for (const alert of state.alerts.value ?? []) {
      if (alert.state === "pending") continue
      const service = serviceOf(alert.labels, estate.catalog.services)
      const store = storeOf(alert.labels, stores)
      const runbook = alert.runbook ?? estate.catalog.services.find((each) => each.name === service)?.runbook
      const kept: StoredFiring = {
        environment,
        alert: alert.id,
        name: alert.name,
        startsAt: alert.startsAt,
        ...(service === undefined ? {} : { service }),
        ...(alert.silence === undefined ? {} : { silence: { by: alert.silence.by, reason: alert.silence.reason } }),
        severity: alert.severity,
        ...(alert.summary === undefined ? {} : { summary: alert.summary }),
        ...(runbook === undefined ? {} : { runbook }),
        ...(store === undefined ? {} : { store }),
      }
      firing.set(keyOf(kept), kept)
    }
  }
  return { answered, firing }
}

/** What to keep: firings begun or silenced since `was`, and those gone from an environment that answered, ended. */
export const changed = (
  was: ReadonlyMap<string, StoredFiring>,
  now: ReturnType<typeof firingNow>,
  at: string,
): ReadonlyArray<StoredFiring> => [
  ...[...now.firing].flatMap(([key, firing]) => {
    const before = was.get(key)
    return before === undefined || before.silence?.by !== firing.silence?.by ? [firing] : []
  }),
  ...[...was].flatMap(([key, firing]) =>
    now.answered.has(firing.environment) && !now.firing.has(key) ? [{ ...firing, endsAt: at }] : [],
  ),
]

export const withFirings = (estate: EstateState, kept: ReadonlyArray<StoredFiring>): EstateState => ({
  ...estate,
  firings: [...kept, ...(estate.firings ?? []).filter((each) => !kept.some((one) => sameFiring(one, each)))],
})

/** What Estate saw happen to a firing it kept: it began, or it ended. */
const seen = (firing: StoredFiring, begun: boolean): ReadonlyArray<StoredEvent> => {
  const at = begun ? firing.startsAt : firing.endsAt
  if (at === undefined) return []
  const about = firing.service ?? firing.store
  const said = [firing.name, firing.severity, about].filter((each) => each !== undefined)
  return [
    {
      id: crypto.randomUUID(),
      environment: firing.environment,
      alert: firing.alert,
      startsAt: firing.startsAt,
      at,
      recordedAt: at,
      source: "seen",
      ...(about === undefined ? {} : { service: about }),
      by: "Estate",
      kind: begun ? "fired" : "resolved",
      text: begun ? said.join(", ") : `after ${lasting((Date.parse(at) - Date.parse(firing.startsAt)) / 60_000)}`,
    },
  ]
}

/** Firings kept, into this process's own state. */
export const keptHere = (kept: ReadonlyArray<StoredFiring>): Effect.Effect<void, never, Estate> =>
  updateEstate((estate) => withFirings(estate, kept))

/**
 * For as long as Estate runs: each firing kept as it begins, is silenced and ends; a told one's end said in Slack.
 * `shown` puts what was kept where the estate's firings are: this process's state, or the cluster's estate owner.
 */
export const recordFirings = <R = never>(
  slack?: SlackSettings,
  shown: (kept: ReadonlyArray<StoredFiring>) => Effect.Effect<void, never, R | Estate> = keptHere,
) =>
  Effect.gen(function* () {
    const ref = yield* Estate
    const notes = yield* Notes
    const open = (yield* SubscriptionRef.get(ref)).firings?.filter((firing) => firing.endsAt === undefined) ?? []
    let was: ReadonlyMap<string, StoredFiring> = new Map(open.map((firing) => [keyOf(firing), firing]))
    yield* SubscriptionRef.changes(ref).pipe(
      Stream.map(firingNow),
      Stream.runForEach((now) =>
        Effect.gen(function* () {
          const kept = changed(was, now, iso(yield* Clock.currentTimeMillis))
          const events = kept.flatMap((firing) =>
            firing.endsAt !== undefined ? seen(firing, false) : was.has(keyOf(firing)) ? [] : seen(firing, true),
          )
          was = new Map([...now.firing].concat([...was].filter(([, firing]) => !now.answered.has(firing.environment))))
          if (kept.length === 0) return
          yield* Effect.forEach(kept, (firing) => notes.keepFiring(firing), { discard: true }).pipe(
            Effect.catch((failure) => Effect.logWarning(`a firing could not be kept: ${failure.message}`)),
          )
          yield* Effect.forEach(events, (event) => notes.addEvent(event), { discard: true }).pipe(
            Effect.catch((failure) => Effect.logWarning(`a firing's event could not be kept: ${failure.message}`)),
          )
          yield* shown(kept)
          yield* Effect.forEach(
            kept.filter((firing) => firing.endsAt !== undefined),
            (firing) =>
              replyInThread(
                slack,
                firing,
                `✅ Resolved after ${lasting((Date.parse(firing.endsAt ?? "") - Date.parse(firing.startsAt)) / 60_000)}`,
              ),
            { discard: true },
          )
        }),
      ),
    )
  })

/**
 * The firings of the last `days`, and the incidents of the last `keepDays` with their firings, into the state as Estate
 * starts; those that ended today are what resolved.
 */
export const loadHistory = (days: number, keepDays: number) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const notes = yield* Notes
    const since = iso(before(now, Duration.days(days)))
    const incidents = yield* notes.incidents(iso(before(now, Duration.days(Math.max(days, keepDays)))))
    const inIncidents = keptBy(incidents.flatMap((incident) => incident.firings))
    const firings = (yield* notes.firings(iso(before(now, Duration.days(Math.max(days, keepDays)))))).filter(
      (firing) => firing.startsAt >= since || inIncidents(firing),
    )
    const threads = yield* notes.threads(since)
    const today = iso(before(now, Duration.days(1)))
    yield* updateEstate((estate) => ({
      ...estate,
      firings,
      threads,
      incidents,
      environments: Object.fromEntries(
        Object.entries(estate.environments).map(([name, state]) => [
          name,
          {
            ...state,
            resolved: [
              ...state.resolved,
              ...firings
                .filter(
                  (firing) => firing.environment === name && firing.endsAt !== undefined && firing.endsAt >= today,
                )
                .map((firing) => ({
                  alert: firing.alert,
                  name: firing.name,
                  labels: firing.service === undefined ? {} : { service: firing.service },
                  startsAt: firing.startsAt,
                  endsAt: firing.endsAt ?? "",
                })),
            ],
          },
        ]),
      ),
    }))
  })

/**
 * Every hour, from the store and the page: incidents older than `keepDays`, with all they hold; then firings older than
 * `days`, but those an incident still holds.
 */
export const sweepHistory = (days: number, keepDays: number) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const [cutoff, kept] = [iso(before(now, Duration.days(days))), iso(before(now, Duration.days(keepDays)))]
    const notes = yield* Notes
    yield* notes.removeIncidentsBefore(kept)
    const held = (yield* notes.incidents(kept)).flatMap((incident) => incident.firings)
    yield* notes.removeFiringsBefore(cutoff, held)
    yield* updateEstate((estate) => ({
      ...estate,
      firings: (estate.firings ?? []).filter((firing) => firing.startsAt >= cutoff || keptBy(held)(firing)),
      ...(estate.incidents === undefined
        ? {}
        : { incidents: estate.incidents.filter((incident) => incident.openedAt >= kept) }),
    }))
  }).pipe(
    Effect.catch((failure) => Effect.logWarning(`old firings could not be removed: ${failure.message}`)),
    (sweep) => forEver(sweep, "1 hour"),
  )
