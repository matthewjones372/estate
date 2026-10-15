/** The catalog's journeys in an environment, the services each crosses, and how its names become a trace's lanes. */
import type { Catalog, Journey } from "../../shared/catalog"
import type { Lane, Lanes } from "../../shared/traces"

export const journeysIn = (catalog: Catalog, environment: string): ReadonlyArray<Journey> =>
  (catalog.journeys ?? []).filter((journey) => journey.environments.includes(environment))

const nodeLane = (node: NonNullable<Catalog["map"]>["nodes"][number]): Lane => ({
  id: node.id,
  title: node.title ?? node.service ?? node.store ?? node.id,
})

/** A stage's `where` is a map node, or a service or store, drawn as its node where the map has one. */
export const lanesOf = (catalog: Catalog): Lanes => {
  const nodes = catalog.map?.nodes ?? []
  const named = (name: string): Lane => {
    const node = nodes.find((each) => each.service === name || each.store === name)
    return node === undefined ? { id: name, title: name } : nodeLane(node)
  }
  return {
    where: (where) => {
      const node = nodes.find((each) => each.id === where)
      return node === undefined ? named(where) : nodeLane(node)
    },
    service: named,
  }
}

/** The catalog's services a journey's stages happen in, and the service that starts it. */
export const servicesOf = (catalog: Catalog, journey: Journey): ReadonlyArray<string> => {
  const services = new Set(catalog.services.map((service) => service.name))
  const nodes = catalog.map?.nodes ?? []
  const crossed = [journey.start.service, ...journey.stages.map((stage) => stage.where)].flatMap((where) => {
    const service = nodes.find((node) => node.id === where)?.service ?? where
    return services.has(service) ? [service] : []
  })
  return [...new Set(crossed)]
}

/** A place on the map a journey passes through, and the stages it spends there, by their place in the journey. */
interface Place {
  readonly node: string
  readonly stages: ReadonlyArray<number>
}

/**
 * The map's nodes a journey passes through, in order: where it starts, then each stage's, a node it stays at for
 * several stages once. A stage somewhere the map does not draw is left out.
 */
export const placesOf = (catalog: Catalog, journey: Journey): ReadonlyArray<Place> => {
  const nodes = catalog.map?.nodes ?? []
  const nodeOf = (where: string) =>
    nodes.find((node) => node.id === where)?.id ??
    nodes.find((node) => node.service === where || node.store === where)?.id
  const steps = [
    { node: nodeOf(journey.start.service), stage: undefined },
    ...journey.stages.map((stage, index) => ({ node: nodeOf(stage.where), stage: index })),
  ]
  return steps.reduce<ReadonlyArray<Place>>((places, step) => {
    if (step.node === undefined) return places
    const last = places.at(-1)
    const stages = step.stage === undefined ? [] : [step.stage]
    return last?.node === step.node
      ? [...places.slice(0, -1), { node: last.node, stages: [...last.stages, ...stages] }]
      : [...places, { node: step.node, stages }]
  }, [])
}
