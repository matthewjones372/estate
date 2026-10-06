/** The doctor's `discover` line: what an environment's cluster holds for the catalog's rules, and what was left out. */
import { Effect } from "effect"
import type { Catalog } from "../shared/catalog"
import { entryOf as backstageEntry, componentsIn } from "./discover/backstage"
import { entryOf, together, workloadsIn } from "./discover/kubernetes"
import { type Checked, checked, shown } from "./discover/merge"
import { services } from "./discover/run"
import { finding } from "./doctor-finding"
import type { Sources } from "./settings"
import type { Backstage } from "./settings-backstage"
import { clusterOf } from "./sources/kubernetes"
import { runtimeOf } from "./sources/ports"

const counted = (count: number) => `${count} service${count === 1 ? "" : "s"}`

/** What a rule found, said: how many, which were written over, and which were left out and why. */
const said = (catalog: Catalog, { kept, leftOut }: Checked) => {
  const { writtenOver } = shown(catalog, together(kept))
  return [
    `${counted(together(kept).length)} found`,
    ...(writtenOver.length === 0 ? [] : [`${writtenOver.length} written over (${writtenOver.join(", ")})`]),
    ...(leftOut.length === 0
      ? []
      : [
          `${leftOut.length} left out (${leftOut.map((each) => `${each.name}: ${each.mistakes[0]?.message ?? ""}`).join("; ")})`,
        ]),
  ].join(", ")
}

/** The line, when the catalog has rules and the environment is read from Kubernetes; none otherwise. */
export const discoverFinding = (section: Sources, catalog: Catalog, environment: string) => {
  const rules = (catalog.discover ?? []).flatMap((rule) =>
    rule.kubernetes === undefined ? [] : [{ ...rule, kubernetes: rule.kubernetes }],
  )
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
  return finding("discover", found, (entries) => said(catalog, checked(catalog, entries.flat())))
}

/** The doctor's Backstage line, for the whole estate: what each Backstage rule finds; none without one. */
export const backstageFinding = (backstage: Backstage | undefined, catalog: Catalog) => {
  const rules = (catalog.discover ?? []).filter((rule) => rule.backstage !== undefined)
  if (rules.length === 0 || backstage === undefined) return Effect.succeed(undefined)
  const environments = catalog.environments.map((each) => each.name)
  const found = Effect.forEach(rules, (rule) =>
    Effect.map(componentsIn(backstage, rule.backstage?.filter ?? services), (components) =>
      components.map((component) => backstageEntry(rule, environments, component)),
    ),
  )
  return finding(
    "discover",
    found,
    (entries) => `Backstage: ${said(catalog, checked(catalog, entries.flat(), "backstage"))}`,
  )
}
