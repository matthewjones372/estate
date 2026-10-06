/**
 * What a `discover:` rule may say: a label selector to find workloads by, and an entry whose values name only what a
 * found workload has: its name, namespace, service name, and its labels and annotations.
 */
import type { Catalog } from "./catalog"
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

export const discoverMistakes = (catalog: Catalog): ReadonlyArray<Mistake> => [
  ...catalog.services.flatMap((service, index) =>
    service.discovered === undefined
      ? []
      : [{ at: `services[${index}] (${service.name}).discovered`, message: "is set by discovery, never written" }],
  ),
  ...(catalog.discover ?? []).flatMap((rule, index) => {
    const at = `discover[${index}]`
    const selector =
      rule.kubernetes.selector.trim() === ""
        ? [{ at: `${at}.kubernetes.selector`, message: "is empty; discovery finds only workloads labelled so" }]
        : []
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
    return [...selector, ...named]
  }),
]
