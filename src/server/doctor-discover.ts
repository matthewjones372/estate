/** The doctor's `discover` line: what an environment's cluster holds for the catalog's rules, and what was left out. */
import { Effect } from "effect"
import type { Catalog } from "../shared/catalog"
import { entryOf, together, workloadsIn } from "./discover/kubernetes"
import { checked, shown } from "./discover/merge"
import { finding } from "./doctor-finding"
import type { Sources } from "./settings"
import { clusterOf } from "./sources/kubernetes"
import { runtimeOf } from "./sources/ports"

const services = (count: number) => `${count} service${count === 1 ? "" : "s"}`

/** The line, when the catalog has rules and the environment is read from Kubernetes; none otherwise. */
export const discoverFinding = (section: Sources, catalog: Catalog, environment: string) => {
  const rules = catalog.discover ?? []
  const kubernetes = section.kubernetes
  if (rules.length === 0 || runtimeOf(section) !== "kubernetes" || kubernetes === undefined)
    return Effect.succeed(undefined)
  const found = Effect.flatMap(clusterOf(kubernetes), (cluster) =>
    Effect.forEach(rules, (rule) =>
      Effect.map(workloadsIn(cluster, rule.kubernetes), (workloads) =>
        workloads.map((workload) => entryOf(rule, environment, workload)),
      ),
    ),
  )
  return finding("discover", found, (entries) => {
    const { kept, leftOut } = checked(catalog, entries.flat())
    const { writtenOver } = shown(catalog, together(kept))
    const found = together(kept).length
    return [
      `${services(found)} found`,
      ...(writtenOver.length === 0 ? [] : [`${writtenOver.length} written over (${writtenOver.join(", ")})`]),
      ...(leftOut.length === 0
        ? []
        : [
            `${leftOut.length} left out (${leftOut.map((each) => `${each.name}: ${each.mistakes[0]?.message ?? ""}`).join("; ")})`,
          ]),
    ].join(", ")
  })
}
