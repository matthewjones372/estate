/** The `feed` event: what changed in the last day, read from the sources' own times and Estate's records. */
import { Duration } from "effect"
import { compact } from "../../shared/compact"
import type { FeedEvent, FeedItem } from "../../shared/events"
import type { EstateState } from "../state"
import { before, iso } from "../time"
import { serviceOf } from "./health"

const shown = 60

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
      add(compact({ at: alert.startsAt, kind: "alert", service, text: `${alert.name} fired` }))
    if (alert.silence !== undefined) {
      const { by, reason, startsAt, endsAt } = alert.silence
      add(
        compact({
          at: startsAt,
          kind: "silence",
          service,
          who: by,
          text: `silenced ${alert.name} until ${endsAt}: ${reason}`,
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
      }),
    )
  }
  for (const note of estate.notes.filter((each) => each.environment === environment)) {
    add({ at: note.at, kind: "note", who: note.by, text: note.text })
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
  for (const [service, jobs] of Object.entries(state.cluster.value?.jobs ?? {})) {
    for (const job of jobs) {
      for (const run of job.runs) {
        if (run.finishedAt !== undefined)
          add({ at: run.finishedAt, kind: "job", service, text: `job ${job.name} ${run.outcome}` })
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
          url: build.url,
          text: `build ${build.status === "success" ? "passed" : "failed"}: ${build.title}`,
        })
      }
    }
  }
  return { items: items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, shown) }
}
