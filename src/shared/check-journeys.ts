/** What a journey may say: its environments, and stages that are a span or two edges, each in a known place. */
import type { Catalog } from "./catalog"
import type { Mistake } from "./shape"

export const journeyMistakes = (catalog: Catalog): ReadonlyArray<Mistake> => {
  const environments = new Set(catalog.environments.map((environment) => environment.name))
  const places = new Set([
    ...(catalog.map?.nodes ?? []).map((node) => node.id),
    ...catalog.services.map((service) => service.name),
    ...(catalog.stores ?? []).map((store) => store.name),
  ])
  const journeys = catalog.journeys ?? []
  const names = journeys.map((journey) => journey.name)
  const twice = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort()
  return [
    ...twice.map((name) => ({ at: "journeys", message: `"${name}" is named twice` })),
    ...journeys.flatMap((journey, index) => {
      const at = `journeys[${index}] (${journey.name})`
      return [
        ...journey.environments
          .filter((environment) => !environments.has(environment))
          .map((environment) => ({ at: `${at}.environments`, message: `"${environment}" is not an environment` })),
        ...(journey.stages.length === 0 ? [{ at: `${at}.stages`, message: "names no stage" }] : []),
        ...journey.stages.flatMap((stage, place) => {
          const where = `${at}.stages[${place}] (${stage.title})`
          const edges = stage.from !== undefined || stage.to !== undefined
          const both = stage.from !== undefined && stage.to !== undefined
          return [
            ...(places.has(stage.where)
              ? []
              : [{ at: `${where}.where`, message: `"${stage.where}" is not a map node, service or store` }]),
            ...(stage.span !== undefined && edges
              ? [{ at: where, message: "is a span or from one edge to another, not both" }]
              : stage.span === undefined && !both
                ? [{ at: where, message: "needs a span, or from: and to:" }]
                : []),
          ]
        }),
      ]
    }),
  ]
}
