/**
 * What a `discover:` rule may say: a label selector to find workloads by, and an entry whose values name only what a
 * found workload has: its name, namespace, service name, and its labels and annotations. A Kafka rule names the
 * labels that tell clusters apart, and fills a store whose values name only those labels.
 */
import type { Catalog, DiscoverRule } from "./catalog"
import type { Mistake } from "./shape"

/** A placeholder a rule fills: `{name}`, or `{label:app.kubernetes.io/part-of}`. */
export const placeholder = /\{([\w./-]+(?::[\w./-]+)?)\}/g

const filled = ["name", "namespace", "service"]

/** Every string in a value, with where it is. */
const strings = (at: string, value: unknown): ReadonlyArray<readonly [string, string]> =>
  typeof value === "string"
    ? [[at, value]]
    : Array.isArray(value)
      ? value.flatMap((each, index) => strings(`${at}[${index}]`, each))
      : typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, each]) => strings(`${at}.${key}`, each))
        : []

/** A Kafka rule's labels, and a store filled only from them; links may also name what a written link does. */
const kafkaMistakes = (at: string, rule: DiscoverRule): ReadonlyArray<Mistake> => {
  if (rule.kafka === undefined)
    return rule.store === undefined ? [] : [{ at: `${at}.store`, message: "is filled only by a kafka rule" }]
  const by = rule.kafka.by
  const labels = by.map((label) => `{label:${label}}`).join(", ")
  const named = strings(`${at}.store`, rule.store).flatMap(([where, text]) =>
    [...text.matchAll(placeholder)].flatMap(([whole, name = ""]) =>
      by.some((label) => name === `label:${label}`) || (where.includes(".links.") && !name.startsWith("label:"))
        ? []
        : [{ at: where, message: `${whole} is not one of the rule's labels: ${labels}` }],
    ),
  )
  return [
    ...(by.length === 0
      ? [{ at: `${at}.kafka.by`, message: "is empty; name the labels that tell one cluster from another" }]
      : []),
    ...(rule.service === undefined
      ? []
      : [{ at: `${at}.service`, message: "is for services; a kafka rule fills a store:" }]),
    ...named,
  ]
}

const marked = (
  kind: "services" | "stores",
  entries: ReadonlyArray<{ readonly name: string; readonly discovered?: unknown }>,
): ReadonlyArray<Mistake> =>
  entries.flatMap((entry, index) =>
    entry.discovered === undefined
      ? []
      : [{ at: `${kind}[${index}] (${entry.name}).discovered`, message: "is set by discovery, never written" }],
  )

export const discoverMistakes = (catalog: Catalog): ReadonlyArray<Mistake> => [
  ...marked("services", catalog.services),
  ...marked("stores", catalog.stores ?? []),
  ...(catalog.discover ?? []).flatMap((rule, index) => {
    const at = `discover[${index}]`
    const kinds = [rule.kubernetes, rule.backstage, rule.kafka].filter((kind) => kind !== undefined).length
    const selector =
      kinds !== 1
        ? [{ at, message: "names where to discover: kubernetes, backstage or kafka, one" }]
        : rule.kubernetes !== undefined && rule.kubernetes.selector.trim() === ""
          ? [{ at: `${at}.kubernetes.selector`, message: "is empty; discovery finds only workloads labelled so" }]
          : []
    const environments = new Set(catalog.environments.map((each) => each.name))
    const unknown = [...(rule.service?.environments ?? []), ...(rule.store?.environments ?? [])]
      .filter((name) => !environments.has(name))
      .map((name) => ({
        at: `${at}.${rule.store === undefined ? "service" : "store"}.environments`,
        message: `"${name}" is not an environment`,
      }))
    const named = strings(`${at}.service`, rule.service).flatMap(([where, text]) =>
      [...text.matchAll(placeholder)].flatMap(([, name = ""]) =>
        filled.includes(name) || /^(label|annotation):/.test(name) || where.includes(".links.")
          ? []
          : [
              {
                at: where,
                message: `{${name}} is not one of {name}, {namespace}, {service}, {label:KEY} or {annotation:KEY}`,
              },
            ],
      ),
    )
    return [...selector, ...unknown, ...named, ...kafkaMistakes(at, rule)]
  }),
]
