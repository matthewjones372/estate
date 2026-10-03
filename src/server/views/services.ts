/**
 * The `services` event: each source's state, each environment's worst, each service's health, pods, load and debug,
 * and each store's health and stats.
 */
import { compact } from "../../shared/compact"
import type { ServicesEvent, SourceKind, SourceStatus } from "../../shared/events"
import type { EnvironmentState, EstateState, Part } from "../state"
import { inEnvironment, jobsIn } from "./catalog"
import { healthOf, worst } from "./health"
import { jobHealthOf } from "./jobs"
import { storeHealthOf, storesIn } from "./stores"

const status = (kind: SourceKind, part: Part<unknown>, tool: string | undefined): SourceStatus =>
  compact({ kind, tool, state: part.state, message: part.message, answeredAt: part.answeredAt })

/** The version an image runs: its tag, or the start of its digest. */
export const versionOf = (image: string | undefined): string | undefined => {
  if (image === undefined) return undefined
  const [name = "", digest] = image.split("@")
  const colon = name.lastIndexOf(":")
  if (colon > name.lastIndexOf("/")) return name.slice(colon + 1)
  return digest === undefined ? "latest" : digest.replace("sha256:", "").slice(0, 12)
}

const environmentWorst = (estate: EstateState, name: string, state: EnvironmentState) =>
  worst([
    ...inEnvironment(estate.catalog, name).map((service) => healthOf(service, state, estate.catalog.services).health),
    ...storesIn(estate.catalog, name).map(
      (store) => storeHealthOf(store, state, storesIn(estate.catalog, name)).health,
    ),
    ...jobsIn(estate.catalog, name).map((job) => jobHealthOf(job, state).health),
  ])

export const servicesView = (estate: EstateState, environment: string): ServicesEvent => {
  const state = estate.environments[environment]
  if (state === undefined) return { sources: [], environments: [], services: [], vitals: [], edges: [] }
  const metrics = state.metrics.value
  const firing = new Set(
    (state.alerts.value ?? []).filter((alert) => alert.state === "firing").map((alert) => alert.name),
  )
  return {
    sources: [
      status("alerts", state.alerts, state.tools.alerts),
      status("cluster", state.cluster, state.tools.cluster),
      status("deploys", state.deploys, state.tools.deploys),
      status("metrics", state.metrics, state.tools.metrics),
      status("builds", estate.builds, state.tools.builds),
    ],
    environments: Object.entries(estate.environments).map(([name, each]) => ({
      name,
      worst: environmentWorst(estate, name, each),
    })),
    services: inEnvironment(estate.catalog, environment).map((service) => {
      const pods = state.cluster.value?.pods[service.name] ?? []
      const { health, reasons } = healthOf(service, state, estate.catalog.services)
      return compact({
        name: service.name,
        health,
        reasons,
        pods,
        jobs: state.cluster.value?.jobs?.[service.name] ?? [],
        version: versionOf(pods.find((pod) => pod.ready)?.image ?? pods[0]?.image),
        load: metrics?.services[service.name] ?? {},
        debug: state.cluster.value?.debug[service.name],
      })
    }),
    ...(estate.catalog.stores === undefined
      ? {}
      : {
          stores: storesIn(estate.catalog, environment).map((store) => ({
            name: store.name,
            ...storeHealthOf(store, state, storesIn(estate.catalog, environment)),
            stats: (metrics?.stores?.[store.name] ?? []).map(({ key: _, ...stat }) => stat),
          })),
        }),
    ...(estate.catalog.jobs === undefined
      ? {}
      : { jobs: jobsIn(estate.catalog, environment).map((job) => ({ name: job.name, ...jobHealthOf(job, state) })) }),
    vitals: (estate.catalog.vitals ?? []).map((vital, index) =>
      compact({ title: vital.title, unit: vital.unit, series: metrics?.vitals[index] ?? { now: null, points: [] } }),
    ),
    edges: (estate.catalog.map?.edges ?? []).map((edge, index) => ({
      from: edge.from,
      to: edge.to,
      rate: metrics?.edges[index] ?? null,
      alerting: edge.alert !== undefined && firing.has(edge.alert),
    })),
  }
}
