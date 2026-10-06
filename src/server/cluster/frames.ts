/**
 * The frames `Follow` sends, and how a follower takes them in: the whole estate first, then only the parts that
 * changed, found by reference as the event stream finds them, so a read that changed one environment's alerts sends
 * those alerts and nothing else.
 */
import type { EnvironmentState, EstateState } from "../state"
import { type Frame, fromWire, toWire } from "./wire"

const sameNames = (before: EstateState, now: EstateState): boolean => {
  const was = Object.keys(before.environments)
  const is = Object.keys(now.environments)
  return was.length === is.length && was.every((name) => now.environments[name] !== undefined)
}

/** The value when it changed, by reference; one that is gone is not sent. */
const ifChanged = <K extends string, A>(key: K, was: A, is: A): { [P in K]?: NonNullable<A> } =>
  was === is || is === undefined || is === null ? {} : ({ [key]: is } as { [P in K]: NonNullable<A> })

const changedIn = (was: EnvironmentState, is: EnvironmentState) => ({
  ...ifChanged("metrics", was.metrics, is.metrics),
  ...ifChanged("alerts", was.alerts, is.alerts),
  ...ifChanged("cluster", was.cluster, is.cluster),
  ...ifChanged("deploys", was.deploys, is.deploys),
  ...ifChanged("costs", was.costs, is.costs),
  ...ifChanged("resolved", was.resolved, is.resolved),
  ...ifChanged("held", was.held, is.held),
})

/** The frame for `now`: the whole, when there was nothing before or the catalog changed; else what changed. */
export const frameOf = (before: EstateState | undefined, now: EstateState, owner: string): Frame => {
  if (before === undefined || before.catalog !== now.catalog || !sameNames(before, now))
    return { _tag: "Whole", owner, estate: toWire(now) }
  const environments = Object.fromEntries(
    Object.entries(now.environments).flatMap(([name, state]) => {
      const was = before.environments[name]
      const changed = was === undefined || was === state ? {} : changedIn(was, state)
      return Object.keys(changed).length === 0 ? [] : [[name, changed]]
    }),
  )
  return {
    _tag: "Changed",
    environments,
    ...ifChanged("builds", before.builds, now.builds),
    ...ifChanged("notes", before.notes, now.notes),
    ...ifChanged("firings", before.firings, now.firings),
    ...ifChanged("threads", before.threads, now.threads),
    ...ifChanged("impacts", before.impacts, now.impacts),
  }
}

/** The owner's frame taken into a follower's state. */
export const followed = (estate: EstateState, frame: Frame): EstateState => {
  if (frame._tag === "Whole") return fromWire(frame.estate)
  const { _tag, environments, ...rest } = frame
  return {
    ...estate,
    ...rest,
    environments: Object.fromEntries(
      Object.entries(estate.environments).map(([name, state]): [string, EnvironmentState] => [
        name,
        { ...state, ...environments[name] },
      ]),
    ),
  }
}
