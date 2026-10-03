/**
 * The catalog's check: its shape by the schema, then what a schema cannot see. Every mistake is named, with where it
 * is, so a broken catalog is fixed in one pass.
 */
import { Result } from "effect"
import { Catalog } from "./catalog"
import { checkShape, type Mistake } from "./shape"
import { statsOf } from "./stats"

const pairs: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" }

/** Whether `text` is a regular expression the logs can use. */
const isPattern = (text: string): boolean => Result.isSuccess(Result.try(() => new RegExp(text)))

/** Brackets and quotes balanced: the mistakes a hand-written PromQL query makes most. */
export const queryMistake = (query: string): string | undefined => {
  if (query.trim() === "") return "is empty"
  const open: string[] = []
  let quote: string | undefined
  for (const char of query) {
    if (quote !== undefined) {
      if (char === quote) quote = undefined
    } else if (char === '"' || char === "'" || char === "`") {
      quote = char
    } else if (pairs[char] !== undefined) {
      open.push(pairs[char])
    } else if (char === ")" || char === "]" || char === "}") {
      if (open.pop() !== char) return `has an unmatched ${char}`
    }
  }
  if (quote !== undefined) return `has an unclosed ${quote}`
  const last = open.at(-1)
  return last === undefined ? undefined : `is missing a ${last}`
}

const placeholders = new Set(["env", "namespace", "service"])

const duplicates = (names: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort()

const sense = (catalog: Catalog): ReadonlyArray<Mistake> => {
  const mistakes: Mistake[] = []
  const mistake = (at: string, message: string) => mistakes.push({ at, message })
  const environments = new Set(catalog.environments.map((environment) => environment.name))
  const services = new Set(catalog.services.map((service) => service.name))
  const query = (at: string, text: string | undefined) => {
    const wrong = text === undefined ? undefined : queryMistake(text)
    if (wrong !== undefined) mistake(at, `the query ${wrong}`)
  }

  if (catalog.environments.length === 0) mistake("environments", "names no environment")
  for (const name of duplicates([...catalog.environments.map((environment) => environment.name)])) {
    mistake("environments", `"${name}" is named twice`)
  }
  for (const name of duplicates(catalog.services.map((service) => service.name))) {
    mistake("services", `"${name}" is named twice`)
  }
  catalog.services.forEach((service, index) => {
    const at = `services[${index}] (${service.name})`
    for (const environment of service.environments) {
      if (!environments.has(environment)) mistake(`${at}.environments`, `"${environment}" is not an environment`)
    }
    query(`${at}.load.requests`, service.load?.requests)
    query(`${at}.load.errors`, service.load?.errors)
    query(`${at}.load.p99`, service.load?.p99)
    statsOf(service).forEach((stat) => {
      query(`${at}.stats (${stat.title})`, stat.query)
    })
    const valued = catalog.environments.filter((environment) => service.environments.includes(environment.name))
    for (const [name, template] of Object.entries(service.links ?? {})) {
      for (const [, placeholder] of template.matchAll(/\{(\w+)\}/g)) {
        if (placeholder === undefined || placeholders.has(placeholder)) continue
        const lacking = valued
          .filter((environment) => environment.values?.[placeholder] === undefined)
          .map((each) => each.name)
        if (lacking.length > 0) {
          mistake(
            `${at}.links.${name}`,
            `{${placeholder}} is not one of {env}, {namespace}, {service}, nor a value ${[...new Set(lacking)].join(" and ")} names`,
          )
        }
      }
    }
    if ((service.jobs ?? []).length > 0 && service.kubernetes === undefined) {
      mistake(`${at}.jobs`, "needs kubernetes.namespace, where its jobs run")
    }
    if (service.debug !== undefined && service.debug.levels.length < 2) {
      mistake(`${at}.debug.levels`, "needs the usual level and the debug level, in that order")
    }
    if (service.repository !== undefined && !/^github:[\w.-]+\/[\w.-]+$/.test(service.repository)) {
      mistake(`${at}.repository`, `"${service.repository}" is not github:owner/name`)
    }
    const logs = service.logs
    if (logs?.errors !== undefined && !isPattern(logs.errors))
      mistake(`${at}.logs.errors`, `"${logs.errors}" is not a pattern`)
    logs?.mask?.forEach((pattern, index) => {
      if (!isPattern(pattern)) mistake(`${at}.logs.mask[${index}]`, `"${pattern}" is not a pattern`)
    })
  })
  catalog.vitals?.forEach((vital, index) => {
    query(`vitals[${index}] (${vital.title})`, vital.query)
  })

  const nodes = catalog.map?.nodes ?? []
  const ids = new Set(nodes.map((node) => node.id))
  for (const id of duplicates(nodes.map((node) => node.id))) mistake("map.nodes", `"${id}" is named twice`)
  nodes.forEach((node, index) => {
    if (node.service !== undefined && !services.has(node.service)) {
      mistake(`map.nodes[${index}] (${node.id})`, `"${node.service}" is not a service`)
    }
  })
  catalog.map?.edges.forEach((edge, index) => {
    const at = `map.edges[${index}] (${edge.from} → ${edge.to})`
    if (!ids.has(edge.from)) mistake(at, `"${edge.from}" is not a node`)
    if (!ids.has(edge.to)) mistake(at, `"${edge.to}" is not a node`)
    query(at, edge.rate)
  })
  return mistakes
}

/** The catalog, or every mistake in it. */
export const checkCatalog = (input: unknown): Result.Result<Catalog, ReadonlyArray<Mistake>> => {
  const shaped = checkShape(Catalog, input)
  if (Result.isFailure(shaped)) return shaped
  const mistakes = sense(shaped.success)
  return mistakes.length === 0 ? Result.succeed(shaped.success) : Result.fail(mistakes)
}
