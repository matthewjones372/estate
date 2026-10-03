/** The `catalog` event: the chosen environment's services with their links filled in, the vitals and the map. */
import type { Catalog, Environment, Service } from "../../shared/catalog"
import type { CatalogEvent } from "../../shared/events"
import { storesIn } from "./stores"

interface Named {
  readonly name: string
  readonly kubernetes?: { readonly namespace?: string }
}

const fillLink = (template: string, environment: Environment, named: Named): string =>
  template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (name === "env") return environment.name
    if (name === "service" || name === "store") return named.name
    if (name === "namespace") return named.kubernetes?.namespace ?? named.name
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
    ...(service.runbook === undefined ? {} : { runbook: service.runbook }),
    ...(service.repository === undefined ? {} : { repository: service.repository }),
    links: linksOf(catalog, environment, service, service.links),
    ...(service.debug === undefined ? {} : { debug: { levels: service.debug.levels } }),
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
          engine: store.engine,
          links: linksOf(catalog, environment, store, store.links),
        })),
      }),
  map: {
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
