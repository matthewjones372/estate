/** The `feed` event: what changed in the last day, read from the sources' own times and Estate's records. */
import { Duration } from "effect"
import { compact } from "../../shared/compact"
import type { FeedEvent, FeedItem } from "../../shared/feed"
import type { StoredNote } from "../notes"
import type { EnvironmentState, EstateState } from "../state"
import { before, iso } from "../time"
import { serviceOf } from "./health"

const shown = 60

/**
 * What a note on an alert opens, and the alert's name: the alert while the firing it was written on still fires,
 * else the past firing it was written in, the latest begun before it; else the alert, once its firings are swept.
 */
const noteOn = (estate: EstateState, state: EnvironmentState, note: StoredNote): Partial<FeedItem> => {
  const live = state.alerts.value?.find((alert) => alert.id === note.alert)
  if (live !== undefined && Date.parse(note.at) >= Date.parse(live.startsAt)) return { on: live.name, alert: live.id }
  const past = (estate.firings ?? [])
    .filter(
      (firing) =>
        firing.environment === note.environment &&
        firing.alert === note.alert &&
        Date.parse(firing.startsAt) <= Date.parse(note.at),
    )
    .toSorted((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0]
  if (past !== undefined) return { on: past.name, firing: { alert: past.alert, startsAt: past.startsAt } }
  return compact({ on: live?.name, alert: note.alert })
}

export const feedView = (estate: EstateState, environment: string, now: number): FeedEvent => {
  const state = estate.environments[environment]
  if (state === undefined) return { items: [] }
  const since = iso(before(now, Duration.days(1)))
  const services = estate.catalog.services
  const items: FeedItem[] = []
  const add = (item: FeedItem) => {
    if (item.at >= since) items.push(item)
  }

  for (const alert of state.alerts.value ?? []) {
    const service = serviceOf(alert.labels, services)
    if (alert.state !== "pending")
      add(compact({ at: alert.startsAt, kind: "alert", service, text: `${alert.name} fired`, alert: alert.id }))
    if (alert.silence !== undefined) {
      const { by, reason, startsAt, endsAt } = alert.silence
      add(
        compact({
          at: startsAt,
          kind: "silence",
          service,
          who: by,
          text: `silenced ${alert.name} until ${endsAt}: ${reason}`,
          alert: alert.id,
        }),
      )
    }
  }
  for (const resolved of state.resolved) {
    add(
      compact({
        at: resolved.endsAt,
        kind: "resolved",
        service: serviceOf(resolved.labels, services),
        text: `${resolved.name} resolved`,
        firing: { alert: resolved.alert, startsAt: resolved.startsAt },
      }),
    )
  }
  for (const [agent, usage] of Object.entries(state.metrics.value?.agents ?? {})) {
    if (usage.modelSince !== undefined && usage.model !== undefined)
      add({
        at: usage.modelSince,
        kind: "deploy",
        service: agent,
        text: `${agent} now uses ${usage.model}${usage.modelWas === undefined ? "" : `, not ${usage.modelWas}`}`,
        agent,
      })
  }
  for (const note of estate.notes.filter((each) => each.environment === environment)) {
    add({ at: note.at, kind: "note", who: note.by, text: note.text, ...noteOn(estate, state, note) })
  }
  // An incident spans environments; its notes are in the feed of each it has a firing in.
  for (const incident of estate.incidents ?? []) {
    if (!incident.firings.some((firing) => firing.environment === environment)) continue
    for (const note of incident.notes ?? [])
      add({
        at: note.at,
        kind: "note",
        who: note.by,
        text: note.text,
        incident: { id: incident.id, title: incident.title },
      })
  }
  for (const [service, debug] of Object.entries(state.cluster.value?.debug ?? {})) {
    if (debug.on && debug.since !== undefined) {
      add(
        compact({
          at: debug.since,
          kind: "debug",
          service,
          who: debug.by,
          text: `debug on until ${debug.until ?? "switched off"}`,
        }),
      )
    }
  }
  const unowned = new Set((estate.catalog.jobs ?? []).map((job) => job.name))
  // Jobs are kept under the service that runs them, or under their own name when no service owns them.
  for (const [owner, jobs] of Object.entries(state.cluster.value?.jobs ?? {})) {
    for (const job of jobs) {
      for (const run of job.runs) {
        if (run.finishedAt !== undefined)
          add({
            at: run.finishedAt,
            kind: "job",
            service: owner,
            text: `job ${job.name} ${run.outcome}`,
            ...(unowned.has(owner) ? { job: owner } : {}),
          })
      }
    }
  }
  for (const [service, chosen] of Object.entries(state.deploys.value ?? {})) {
    if (chosen.at !== undefined) add({ at: chosen.at, kind: "deploy", service, text: `${chosen.version} applied` })
  }
  for (const [service, builds] of Object.entries(estate.builds.value ?? {})) {
    for (const build of builds) {
      if (build.status === "success" || build.status === "failure") {
        add({
          at: build.at,
          kind: "build",
          service,
          ...(build.url === "" ? {} : { url: build.url }),
          text: `build ${build.status === "success" ? "passed" : "failed"}: ${build.title}`,
        })
      }
    }
  }
  return { items: items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, shown) }
}
