/**
 * Each alert's firings, kept: when it started, who silenced it and why, and when it ended. They are written as Estate
 * sees them happen, compared only once an environment's alerts have answered, so a slow start ends nothing.
 */
import { Clock, Duration, Effect, Stream, SubscriptionRef } from "effect"
import { Notes, type StoredFiring, sameFiring } from "./notes"
import { forEver } from "./schedule"
import { Estate, type EstateState, updateEstate } from "./state"
import { before, iso } from "./time"
import { serviceOf } from "./views/health"

const keyOf = (firing: Pick<StoredFiring, "environment" | "alert" | "startsAt">) =>
  `${firing.environment}\u0000${firing.alert}\u0000${firing.startsAt}`

/** What fires now in each environment whose alerts have answered, by firing; and those environments. */
export const firingNow = (estate: EstateState) => {
  const answered = new Set<string>()
  const firing = new Map<string, StoredFiring>()
  for (const [environment, state] of Object.entries(estate.environments)) {
    if (state.alerts.state !== "ok") continue
    answered.add(environment)
    for (const alert of state.alerts.value ?? []) {
      if (alert.state === "pending") continue
      const service = serviceOf(alert.labels, estate.catalog.services)
      const kept: StoredFiring = {
        environment,
        alert: alert.id,
        name: alert.name,
        startsAt: alert.startsAt,
        ...(service === undefined ? {} : { service }),
        ...(alert.silence === undefined ? {} : { silence: { by: alert.silence.by, reason: alert.silence.reason } }),
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

const withFirings = (estate: EstateState, kept: ReadonlyArray<StoredFiring>): EstateState => ({
  ...estate,
  firings: [...kept, ...(estate.firings ?? []).filter((each) => !kept.some((one) => sameFiring(one, each)))],
})

/** For as long as Estate runs: each firing kept as it begins, is silenced and ends. */
export const recordFirings = Effect.gen(function* () {
  const ref = yield* Estate
  const notes = yield* Notes
  const open = (yield* SubscriptionRef.get(ref)).firings?.filter((firing) => firing.endsAt === undefined) ?? []
  let was: ReadonlyMap<string, StoredFiring> = new Map(open.map((firing) => [keyOf(firing), firing]))
  yield* SubscriptionRef.changes(ref).pipe(
    Stream.map(firingNow),
    Stream.runForEach((now) =>
      Effect.gen(function* () {
        const kept = changed(was, now, iso(yield* Clock.currentTimeMillis))
        was = new Map([...now.firing].concat([...was].filter(([, firing]) => !now.answered.has(firing.environment))))
        if (kept.length === 0) return
        yield* Effect.forEach(kept, (firing) => notes.keepFiring(firing), { discard: true }).pipe(
          Effect.catch((failure) => Effect.logWarning(`a firing could not be kept: ${failure.message}`)),
        )
        yield* updateEstate((estate) => withFirings(estate, kept))
      }),
    ),
  )
})

/** The firings of the last `days`, into the state as Estate starts; those that ended today are what resolved. */
export const loadHistory = (days: number) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const firings = yield* (yield* Notes).firings(iso(before(now, Duration.days(days))))
    const today = iso(before(now, Duration.days(1)))
    yield* updateEstate((estate) => ({
      ...estate,
      firings,
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

/** Every hour, firings older than `days` removed, from the store and the page. */
export const sweepHistory = (days: number) =>
  Effect.gen(function* () {
    const cutoff = iso(before(yield* Clock.currentTimeMillis, Duration.days(days)))
    yield* (yield* Notes).removeFiringsBefore(cutoff)
    yield* updateEstate((estate) => ({
      ...estate,
      firings: (estate.firings ?? []).filter((firing) => firing.startsAt >= cutoff),
    }))
  }).pipe(
    Effect.catch((failure) => Effect.logWarning(`old firings could not be removed: ${failure.message}`)),
    (sweep) => forEver(sweep, "1 hour"),
  )
