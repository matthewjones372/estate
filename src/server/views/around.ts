/**
 * An alert's brief from the state Estate holds: what changed near it, what sits next to it on the map and how that
 * is, and its earlier firings. Its errors and its runbook's text are read when asked, beside this.
 */
import { Duration } from "effect"
import type { Change, Neighbour } from "../../shared/around"
import { compact } from "../../shared/compact"
import type { Alert } from "../../shared/events"
import type { EstateState } from "../state"
import { before, iso } from "../time"
import { alertsView } from "./alerts"
import { healthOf } from "./health"
import { storeHealthOf, storesIn } from "./stores"

/** How long before it fired a change counts as near it. */
const near = Duration.hours(1)

export interface Brief {
  readonly alert: Alert
  readonly subject?: string
  readonly changed: ReadonlyArray<Change>
  readonly depends: ReadonlyArray<Neighbour>
}

/** The services and stores either side of `subject` on the map, and which side each is on. */
const neighboursOf = (estate: EstateState, subject: string) => {
  const map = estate.catalog.map
  if (map === undefined) return []
  const named = (id: string) => {
    const node = map.nodes.find((each) => each.id === id)
    return node?.service !== undefined
      ? { name: node.service, kind: "service" as const }
      : node?.store !== undefined
        ? { name: node.store, kind: "store" as const }
        : undefined
  }
  const here = map.nodes.filter((node) => node.service === subject || node.store === subject).map((node) => node.id)
  const found = map.edges.flatMap((edge) => {
    const other = here.includes(edge.from)
      ? { id: edge.to, side: "calls" as const }
      : here.includes(edge.to)
        ? { id: edge.from, side: "called by" as const }
        : undefined
    const node = other === undefined ? undefined : named(other.id)
    return node === undefined || other === undefined || node.name === subject ? [] : [{ ...node, side: other.side }]
  })
  return found.filter((each, index) => found.findIndex((other) => other.name === each.name) === index)
}

const changesOf = (estate: EstateState, environment: string, services: ReadonlyArray<string>, since: string) => {
  const deploys = estate.environments[environment]?.deploys.value ?? {}
  const changes: Array<Change> = []
  for (const service of services) {
    const chosen = deploys[service]
    if (chosen?.at !== undefined && chosen.at >= since)
      changes.push({
        at: chosen.at,
        service,
        kind: "deploy",
        text:
          chosen.stalled === undefined ? `${chosen.version} deployed` : `${chosen.version} stalled: ${chosen.stalled}`,
      })
    for (const build of estate.builds.value?.[service] ?? [])
      if (build.at >= since && (build.status === "success" || build.status === "failure"))
        changes.push({
          at: build.at,
          service,
          kind: "build",
          text: `build ${build.status === "success" ? "passed" : "failed"}: ${build.title}`,
          url: build.url,
        })
  }
  return changes.sort((a, b) => b.at.localeCompare(a.at))
}

const dependsOf = (
  estate: EstateState,
  environment: string,
  neighbours: ReturnType<typeof neighboursOf>,
): ReadonlyArray<Neighbour> => {
  const state = estate.environments[environment]
  if (state === undefined) return []
  const stores = storesIn(estate.catalog, environment)
  return neighbours.flatMap((neighbour): ReadonlyArray<Neighbour> => {
    if (neighbour.kind === "store") {
      const store = stores.find((each) => each.name === neighbour.name)
      if (store === undefined) return []
      const readings = (state.metrics.value?.stores?.[store.name] ?? []).map((reading) =>
        compact({ title: reading.title, now: reading.series.now, unit: reading.unit }),
      )
      return [{ ...neighbour, ...storeHealthOf(store, state, stores), readings }]
    }
    const service = estate.catalog.services.find((each) => each.name === neighbour.name)
    if (service === undefined || !service.environments.includes(environment)) return []
    const load = state.metrics.value?.services[service.name] ?? {}
    const readings = [
      { title: "requests", now: load.requests?.now, unit: "/s" },
      { title: "errors", now: load.errors?.now, unit: "/s" },
      { title: "p99", now: load.p99?.now, unit: "s" },
    ].flatMap((each) => (each.now === undefined ? [] : [{ ...each, now: each.now }]))
    return [{ ...neighbour, ...healthOf(service, state, estate.catalog.services), readings }]
  })
}

/** The brief of the alert `id` in `environment`, or nothing where no such alert is there now. */
export const aroundView = (estate: EstateState, environment: string, id: string): Brief | undefined => {
  const alert = alertsView(estate, environment, false).alerts.find((each) => each.id === id)
  if (alert === undefined) return undefined
  const subject = alert.service ?? alert.store
  const neighbours = subject === undefined ? [] : neighboursOf(estate, subject)
  const since = iso(before(Date.parse(alert.startsAt), near))
  const services = [
    ...(alert.service === undefined ? [] : [alert.service]),
    ...neighbours.filter((each) => each.kind === "service").map((each) => each.name),
  ]
  return compact({
    alert,
    subject,
    changed: changesOf(estate, environment, services, since),
    depends: dependsOf(estate, environment, neighbours),
  })
}
