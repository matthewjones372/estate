/**
 * Kafka clusters found in Prometheus (spec 0057): one for each set of values of a rule's `by` labels on
 * kafka_exporter's series, each made the store a person would write for it, from the rule's template.
 */
import { Effect, Ref, Result } from "effect"
import type { Catalog, DiscoverRule, Store } from "../../shared/catalog"
import { checkCatalog } from "../../shared/check"
import type { Settings } from "../settings"
import { rangesIn } from "../sources/ranges"
import { filled } from "./kubernetes"

type Labels = Readonly<Record<string, string>>

/** The query that gives one series per cluster, labelled with the values that tell it from the others. */
export const clustersQuery = (rule: NonNullable<DiscoverRule["kafka"]>): string =>
  `count by (${rule.by.join(",")}) (kafka_brokers${rule.selector === undefined ? "" : `{${rule.selector}}`})`

const quoted = (value: string) => JSON.stringify(value)

/** The store a cluster in `environment` becomes, before it is checked as a written one is. */
export const storeOf = (rule: DiscoverRule, environment: string, labels: Labels): unknown => {
  const by = rule.kafka?.by ?? []
  const values = by.flatMap((label) => (labels[label] ? [labels[label]] : []))
  const plain = values.length === 0 ? "kafka" : values.join("-")
  const { name, environments: _, ...template } = rule.store ?? {}
  const named = name === undefined ? undefined : filled(name, { service: plain, labels, annotations: {} })
  return {
    ...(filled(template, { service: plain, labels, annotations: {} }) as object),
    name: typeof named === "string" && named !== "" ? named : plain,
    environments: [environment],
    engine: "kafka",
    selector: [rule.kafka?.selector, ...by.map((label) => `${label}=${quoted(labels[label] ?? "")}`)]
      .filter((each) => each !== undefined && each.trim() !== "")
      .join(","),
    discovered: { from: "prometheus" },
  }
}

/** Each found store checked against the written catalog as if it were written there; a mistaken one left out. */
export const checkedStores = (written: Catalog, entries: ReadonlyArray<unknown>) => {
  const kept: Array<Store> = []
  const leftOut: Array<string> = []
  for (const entry of entries) {
    const { discovered: _, ...unmarked } = entry as Record<string, unknown>
    const name = String(unmarked["name"])
    const result = checkCatalog({
      environments: written.environments,
      services: written.services,
      stores: [...(written.stores ?? []).filter((store) => store.name !== name), unmarked],
    })
    if (Result.isSuccess(result))
      kept.push(
        ...(result.success.stores ?? [])
          .slice(-1)
          .map((store) => ({ ...store, discovered: { from: "prometheus" as const } })),
      )
    else leftOut.push(`${name}: ${result.failure[0]?.message ?? ""}`)
  }
  return { kept, leftOut }
}

/** Stores of one name, found in several environments, as one store in each; its first selector kept. */
export const togetherStores = (stores: ReadonlyArray<Store>): ReadonlyArray<Store> => {
  const byName = new Map<string, Store>()
  for (const store of stores) {
    const was = byName.get(store.name)
    byName.set(
      store.name,
      was === undefined ? store : { ...was, environments: [...new Set([...was.environments, ...store.environments])] },
    )
  }
  return [...byName.values()]
}

/**
 * Each environment's Prometheus asked once what the Kafka rules find, kept by environment; one that does not answer
 * keeps what it found last, and one that cannot list series finds nothing. Returns what was left out, and why.
 */
export const discoverKafka = (
  found: Ref.Ref<Readonly<Record<string, ReadonlyArray<Store>>>>,
  settings: Settings,
  catalog: Catalog,
) =>
  Effect.gen(function* () {
    const rules = (catalog.discover ?? []).filter((rule) => rule.kafka !== undefined)
    const leftOut: Array<string> = []
    for (const environment of catalog.environments) {
      const asked = rules.filter((rule) => rule.store?.environments?.includes(environment.name) ?? true)
      const labels =
        asked.length === 0 ? undefined : (yield* rangesIn(settings.sources[environment.sources] ?? {}))?.labels
      if (labels === undefined) {
        yield* Ref.update(found, ({ [environment.name]: _, ...rest }) => rest)
        continue
      }
      const answered = yield* Effect.result(
        Effect.forEach(asked, (rule) =>
          Effect.map(labels(clustersQuery(rule.kafka ?? { by: [] })), (clusters) =>
            clusters.map((cluster) => storeOf(rule, environment.name, cluster)),
          ),
        ),
      )
      if (answered._tag === "Failure") {
        yield* Effect.logWarning(
          `Kafka clusters could not be discovered in ${environment.name}: ${answered.failure.message}`,
        )
        continue
      }
      const { kept, leftOut: wrong } = checkedStores(catalog, answered.success.flat())
      leftOut.push(...wrong.map((each) => `${environment.name} ${each}`))
      yield* Ref.update(found, (was) => ({ ...was, [environment.name]: kept }))
    }
    return leftOut
  })
