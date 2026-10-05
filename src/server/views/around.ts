/**
 * An alert's brief: what changed near it, what it depends on, earlier firings and its runbook link.
 * Built from the views the page already has; no AI needed. Feeds Ask AI when configured.
 */
import { Duration } from "effect"
import { compact } from "../../shared/compact"
import type { EstateState } from "../state"
import { before, iso } from "../time"
import { serviceOf } from "./health"

const hour = Duration.hours(1)

interface AroundChange {
  readonly kind: "deploy" | "build"
  readonly service: string
  readonly text: string
  readonly at: string
}

interface AroundNeighbour {
  readonly name: string
  readonly health: string
  readonly reasons: ReadonlyArray<string>
}

export interface AroundBrief {
  readonly alert: string
  readonly name: string
  readonly service?: string
  readonly startsAt: string
  readonly summary?: string
  readonly runbook?: string
  readonly changed: ReadonlyArray<AroundChange>
  readonly depends: ReadonlyArray<AroundNeighbour>
  readonly before: ReadonlyArray<{
    readonly startsAt: string
    readonly endsAt?: string
    readonly notes: ReadonlyArray<{ readonly by: string; readonly text: string }>
  }>
  /** One-line summary for the page and for a model. */
  readonly summaryText: string
}

const neighboursOf = (estate: EstateState, service: string | undefined): ReadonlyArray<string> => {
  if (service === undefined) return []
  const map = estate.catalog.map
  if (map === undefined) return []
  const node = map.nodes.find((each) => each.service === service)?.id
  if (node === undefined) return []
  const ids = new Set<string>()
  for (const edge of map.edges) {
    if (edge.from === node) ids.add(edge.to)
    if (edge.to === node) ids.add(edge.from)
  }
  return map.nodes
    .filter((each) => ids.has(each.id) && each.service !== undefined && each.service !== service)
    .map((each) => each.service as string)
}

const changesNear = (
  estate: EstateState,
  environment: string,
  service: string | undefined,
  startsAt: string,
): ReadonlyArray<AroundChange> => {
  if (service === undefined) return []
  const fired = Date.parse(startsAt)
  const windowStart = before(fired, hour)
  const names = new Set([service, ...neighboursOf(estate, service)])
  const found: AroundChange[] = []
  const state = estate.environments[environment]
  for (const name of names) {
    const chosen = state?.deploys.value?.[name]
    if (chosen?.at !== undefined) {
      const when = Date.parse(chosen.at)
      if (when >= windowStart && when <= fired) {
        found.push({
          kind: "deploy",
          service: name,
          text: `${chosen.version} deployed`,
          at: chosen.at,
        })
      }
    }
    for (const build of estate.builds.value?.[name] ?? []) {
      const when = Date.parse(build.at)
      if (when >= windowStart && when <= fired) {
        found.push({
          kind: "build",
          service: name,
          text: `build ${build.status}: ${build.title}`,
          at: build.at,
        })
      }
    }
  }
  return found.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

const minutesBetween = (earlier: string, later: string): number =>
  Math.max(0, Math.round((Date.parse(later) - Date.parse(earlier)) / 60_000))

const summaryOf = (brief: Omit<AroundBrief, "summaryText">): string => {
  const lines: string[] = []
  if (brief.changed.length === 0) {
    lines.push(
      brief.service === undefined
        ? "No service is named on this alert."
        : `No deploys or builds of ${brief.service} in the hour before it fired.`,
    )
  } else {
    for (const change of brief.changed) {
      lines.push(`${change.service} ${change.text} ${minutesBetween(change.at, brief.startsAt)} min before it fired.`)
    }
  }
  for (const neighbour of brief.depends) {
    lines.push(
      `${neighbour.name}: ${neighbour.health}${neighbour.reasons[0] === undefined ? "" : ` (${neighbour.reasons[0]})`}`,
    )
  }
  if (brief.before[0] !== undefined) {
    const last = brief.before[0]
    const note = last.notes[0]
    lines.push(
      `Before: ${brief.before.length === 1 ? "once" : `${brief.before.length} times`}, last ${iso(last.startsAt)}${
        note === undefined ? "" : `: "${note.text}" (${note.by})`
      }`,
    )
  }
  if (brief.runbook !== undefined) lines.push(`Runbook: ${brief.runbook}`)
  return lines.join("\n")
}

/** The brief for one alert in an environment, or undefined when that alert is not there. */
export const aroundOf = (estate: EstateState, environment: string, id: string): AroundBrief | undefined => {
  const state = estate.environments[environment]
  const alert = state?.alerts.value?.find((each) => each.id === id)
  if (alert === undefined || state === undefined) return undefined
  const service = serviceOf(alert.labels, estate.catalog.services)
  const runbook = alert.runbook ?? estate.catalog.services.find((each) => each.name === service)?.runbook
  const neighbourNames = neighboursOf(estate, service)
  const firing = (state.alerts.value ?? []).filter((each) => each.state === "firing")
  const depends: ReadonlyArray<AroundNeighbour> = neighbourNames.map((name) => {
    const about = firing.filter((each) => serviceOf(each.labels, estate.catalog.services) === name)
    return about.length > 0
      ? { name, health: "attention", reasons: about.map((each) => `${each.name} is firing`) }
      : { name, health: "unknown", reasons: [] }
  })
  const notes = estate.notes
    .filter((note) => note.environment === environment && note.alert === alert.id)
    .map(({ at, by, text }) => ({ at, by, text }))
  const earlier = (estate.firings ?? [])
    .filter(
      (firing) => firing.environment === environment && firing.alert === alert.id && firing.startsAt < alert.startsAt,
    )
    .toSorted((a, b) => b.startsAt.localeCompare(a.startsAt))
    .slice(0, 5)
  const beforeRows = earlier.map((firing, index) => {
    const until = earlier[index - 1]?.startsAt ?? alert.startsAt
    return compact({
      startsAt: firing.startsAt,
      endsAt: firing.endsAt,
      notes: notes.filter((note) => note.at >= firing.startsAt && note.at < until),
    })
  })
  const base = compact({
    alert: alert.id,
    name: alert.name,
    service,
    startsAt: alert.startsAt,
    summary: alert.summary,
    runbook,
    changed: changesNear(estate, environment, service, alert.startsAt),
    depends,
    before: beforeRows,
  })
  return { ...base, summaryText: summaryOf(base) }
}
