/** The `catalog` event: the chosen environment's services with their links filled in, the vitals and the map. */
import type { Catalog, Service } from "../../shared/catalog"
import type { CatalogEvent } from "../../shared/events"

const fillLink = (template: string, environment: string, service: Service): string =>
  template
    .replaceAll("{env}", environment)
    .replaceAll("{service}", service.name)
    .replaceAll("{namespace}", service.kubernetes?.namespace ?? service.name)

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
    links: Object.entries(service.links ?? {}).map(([name, template]) => ({
      name,
      url: fillLink(template, environment, service),
    })),
    ...(service.debug === undefined ? {} : { debug: { levels: service.debug.levels } }),
  })),
  vitals: (catalog.vitals ?? []).map((vital) => ({
    title: vital.title,
    ...(vital.unit === undefined ? {} : { unit: vital.unit }),
  })),
  map: {
    nodes: mapIn(catalog, environment).nodes.map((node) => ({
      id: node.id,
      title: node.title ?? node.service ?? node.id,
      kind: node.kind ?? (node.service === undefined ? "store" : "service"),
      ...(node.service === undefined ? {} : { service: node.service }),
    })),
    edges: mapIn(catalog, environment).edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
      ...(edge.label === undefined ? {} : { label: edge.label }),
      ...(edge.alert === undefined ? {} : { alert: edge.alert }),
    })),
  },
})
