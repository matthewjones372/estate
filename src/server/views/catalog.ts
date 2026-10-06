/** The `catalog` event: the chosen environment's services with their links filled in, the vitals and the map. */
import {
  type Agent,
  type Catalog,
  type Environment,
  kubernetesOf,
  runsAs,
  type Service,
  type StandaloneJob,
} from "../../shared/catalog"
import { compact } from "../../shared/compact"
import type { CatalogEvent } from "../../shared/events"
import { storesIn } from "./stores"

/** A discovered entry as it would be written under `services:`, without the mark only discovery sets. */
const asYaml = ({ discovered: _, ...entry }: Service): string =>
  `- ${Bun.YAML.stringify(entry, null, 2).replace(/ +$/gm, "").trimEnd().split("\n").join("\n  ")}\n`

interface Named {
  readonly name: string
  readonly namespace?: string
}

/** Fill `{env}`, the named thing, `{namespace}`, and the environment's values. `{alert}` / `{summary}` stay for the page. */
const fillLink = (template: string, environment: Environment, named: Named): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (name === "env") return environment.name
    if (["service", "store", "job", "team", "agent"].includes(name)) return named.name
    if (name === "namespace") return named.namespace ?? named.name
    if (name === "alert" || name === "summary") return whole
    return environment.values?.[name] ?? whole
  })

const linksOf = (catalog: Catalog, environment: string, named: Named, links: Readonly<Record<string, string>> = {}) =>
  Object.entries(links).map(([name, template]) => ({
    name,
    url: fillLink(
      template,
      catalog.environments.find((each) => each.name === environment) ?? { name: environment, sources: "" },
      named,
    ),
  }))

export const inEnvironment = (catalog: Catalog, environment: string): ReadonlyArray<Service> =>
  catalog.services.filter((service) => service.environments.includes(environment))

/** The AI agents that run in an environment. */
export const agentsIn = (catalog: Catalog, environment: string): ReadonlyArray<Agent> =>
  (catalog.agents ?? []).filter((agent) => agent.environments.includes(environment))

/** The jobs no service owns that run in an environment. */
export const jobsIn = (catalog: Catalog, environment: string): ReadonlyArray<StandaloneJob> =>
  (catalog.jobs ?? []).filter((job) => job.environments.includes(environment))

/** The map's nodes for services here, and stores; its edges between those. */
const mapIn = (catalog: Catalog, environment: string) => {
  const here = new Set(inEnvironment(catalog, environment).map((service) => service.name))
  const nodes = (catalog.map?.nodes ?? []).filter((node) => node.service === undefined || here.has(node.service))
  const ids = new Set(nodes.map((node) => node.id))
  const edges = (catalog.map?.edges ?? []).filter((edge) => ids.has(edge.from) && ids.has(edge.to))
  return { nodes, edges }
}

export const catalogView = (catalog: Catalog, environment: string): CatalogEvent => ({
  environment,
  environments: catalog.environments.map((each) => ({ name: each.name, title: each.title ?? each.name })),
  services: inEnvironment(catalog, environment).map((service) => ({
    name: service.name,
    ...(service.description === undefined ? {} : { description: service.description }),
    ...(service.owner === undefined ? {} : { owner: service.owner }),
    ...(service.category === undefined ? {} : { category: service.category }),
    ...(service.runbook === undefined ? {} : { runbook: service.runbook }),
    ...(service.repository === undefined ? {} : { repository: service.repository }),
    links: linksOf(
      catalog,
      environment,
      { name: service.name, ...compact({ namespace: kubernetesOf(service)?.namespace }) },
      service.links,
    ),
    ...(service.debug === undefined ? {} : { debug: { levels: service.debug.levels } }),
    ...(service.discovered === undefined
      ? {}
      : { discovered: { from: service.discovered.from, yaml: asYaml(service) } }),
  })),
  vitals: (catalog.vitals ?? []).map((vital) => ({
    title: vital.title,
    ...(vital.unit === undefined ? {} : { unit: vital.unit }),
  })),
  ...(catalog.stores === undefined
    ? {}
    : {
        stores: storesIn(catalog, environment).map((store) => ({
          name: store.name,
          ...(store.description === undefined ? {} : { description: store.description }),
          ...(store.category === undefined ? {} : { category: store.category }),
          engine: store.engine,
          links: linksOf(catalog, environment, store, store.links),
        })),
      }),
  ...(catalog.teams === undefined
    ? {}
    : {
        teams: catalog.teams.map((team) => ({
          name: team.name,
          title: team.title ?? team.name,
          links: linksOf(catalog, environment, team, team.links),
        })),
      }),
  ...(catalog.agents === undefined
    ? {}
    : {
        agents: agentsIn(catalog, environment).map((agent) =>
          compact({
            name: agent.name,
            description: agent.description,
            owner: agent.owner,
            category: agent.category,
            runbook: agent.runbook,
            budget: agent.budget,
            runs: agent.runs === undefined ? undefined : true,
            links: linksOf(
              catalog,
              environment,
              { name: agent.name, ...compact({ namespace: agent.runtime?.kubernetes?.namespace }) },
              agent.links,
            ),
          }),
        ),
      }),
  ...(catalog.jobs === undefined
    ? {}
    : {
        jobs: jobsIn(catalog, environment).map((job) =>
          compact({
            name: job.name,
            description: job.description,
            owner: job.owner,
            category: job.category,
            runbook: job.runbook,
            kind: runsAs(job).kind,
            links: linksOf(
              catalog,
              environment,
              {
                name: job.name,
                ...compact({ namespace: "kubernetes" in job.run ? job.run.kubernetes.namespace : undefined }),
              },
              job.links,
            ),
          }),
        ),
      }),
  map: {
    ...(catalog.map?.collapse === undefined ? {} : { collapse: catalog.map.collapse }),
    nodes: mapIn(catalog, environment).nodes.map((node) => ({
      id: node.id,
      title: node.title ?? node.service ?? node.store ?? node.id,
      kind: node.kind ?? (node.service === undefined ? "store" : "service"),
      ...(node.service === undefined ? {} : { service: node.service }),
      ...(node.store === undefined ? {} : { store: node.store }),
    })),
    edges: mapIn(catalog, environment).edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      ...(edge.alert === undefined ? {} : { alert: edge.alert }),
    })),
  },
})
