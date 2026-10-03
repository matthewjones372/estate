/**
 * The catalog's check: its shape by the schema, then what a schema cannot see. Every mistake is named, with where it
 * is, so a broken catalog is fixed in one pass.
 */
import { Result } from "effect"
import { Catalog, ecsOf, kubernetesOf } from "./catalog"
import { checkShape, type Mistake } from "./shape"
import { statsOf } from "./stats"
import { rulesOf } from "./stores"

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

const servicePlaceholders = ["env", "namespace", "service"]
const storePlaceholders = ["env", "store"]
const jobPlaceholders = ["env", "job", "namespace"]
const teamPlaceholders = ["env", "team"]

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
  /** A link's placeholders: its own, or a value every environment it is in names. */
  const links = (
    at: string,
    names: ReadonlyArray<string>,
    templates: Readonly<Record<string, string>> | undefined,
    own: ReadonlyArray<string>,
  ) => {
    const valued = catalog.environments.filter((environment) => names.includes(environment.name))
    for (const [name, template] of Object.entries(templates ?? {})) {
      for (const [, placeholder = ""] of template.matchAll(/\{(\w+)\}/g)) {
        if (own.includes(placeholder)) continue
        const lacking = valued.filter((each) => each.values?.[placeholder] === undefined).map((each) => each.name)
        if (lacking.length > 0) {
          mistake(
            `${at}.links.${name}`,
            `{${placeholder}} is not one of ${own.map((each) => `{${each}}`).join(", ")}, nor a value ${[...new Set(lacking)].join(" and ")} names`,
          )
        }
      }
    }
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
    links(at, service.environments, service.links, servicePlaceholders)
    const deploy = service.deploy
    const tools = [deploy?.flux, deploy?.argo, deploy?.harness].filter((tool) => tool !== undefined)
    if (deploy !== undefined && tools.length !== 1)
      mistake(`${at}.deploy`, "names one deploy tool: flux, argo or harness")
    if (service.kubernetes !== undefined && service.runtime?.kubernetes !== undefined) {
      mistake(at, "names Kubernetes twice, as kubernetes and as runtime.kubernetes; keep one")
    }
    if ((service.jobs ?? []).length > 0 && kubernetesOf(service) === undefined && ecsOf(service) === undefined) {
      mistake(`${at}.jobs`, "needs a runtime, Kubernetes' namespace or ECS's cluster, where its jobs run")
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

  const stores = new Set((catalog.stores ?? []).map((store) => store.name))
  for (const name of duplicates((catalog.stores ?? []).map((store) => store.name))) {
    mistake("stores", `"${name}" is named twice`)
  }
  catalog.stores?.forEach((store, index) => {
    const at = `stores[${index}] (${store.name})`
    if (services.has(store.name)) mistake(at, `"${store.name}" is also a service's name`)
    for (const environment of store.environments) {
      if (!environments.has(environment)) mistake(`${at}.environments`, `"${environment}" is not an environment`)
    }
    if (store.selector.trim() === "") mistake(`${at}.selector`, "is empty")
    links(at, store.environments, store.links, storePlaceholders)
    store.extra?.forEach((extra, extraIndex) => {
      query(`${at}.extra[${extraIndex}] (${extra.title})`, extra.query)
    })
    const known = new Set(rulesOf(store).map((rule) => rule.key))
    for (const key of Object.keys(store.attention ?? {})) {
      if (!known.has(key)) {
        mistake(`${at}.attention.${key}`, `is not one of ${store.engine}'s: ${[...known].join(", ")}`)
      }
    }
  })

  for (const name of duplicates((catalog.jobs ?? []).map((job) => job.name)))
    mistake("jobs", `"${name}" is named twice`)
  catalog.jobs?.forEach((job, index) => {
    const at = `jobs[${index}] (${job.name})`
    if (services.has(job.name) || stores.has(job.name)) mistake(at, `"${job.name}" is also a service's or store's name`)
    for (const environment of job.environments) {
      if (!environments.has(environment)) mistake(`${at}.environments`, `"${environment}" is not an environment`)
    }
    if ("kubernetes" in job.run && job.run.kubernetes.cronJob !== undefined && job.run.kubernetes.job !== undefined)
      mistake(`${at}.run.kubernetes`, "names a cronJob or a job, not both")
    links(at, job.environments, job.links, jobPlaceholders)
  })

  const teams = catalog.teams
  if (teams !== undefined) {
    for (const name of duplicates(teams.map((team) => team.name))) mistake("teams", `"${name}" is named twice`)
    const known = new Set(teams.map((team) => team.name))
    const owned = [
      ...catalog.services.map((each, index) => [`services[${index}] (${each.name}).owner`, each.owner] as const),
      ...(catalog.jobs ?? []).map((each, index) => [`jobs[${index}] (${each.name}).owner`, each.owner] as const),
    ]
    for (const [at, owner] of owned) {
      if (owner !== undefined && !known.has(owner)) mistake(at, `"${owner}" is not one of the teams`)
    }
    const everywhere = catalog.environments.map((environment) => environment.name)
    teams.forEach((team, index) => {
      links(`teams[${index}] (${team.name})`, everywhere, team.links, teamPlaceholders)
    })
  }

  const nodes = catalog.map?.nodes ?? []
  const ids = new Set(nodes.map((node) => node.id))
  for (const id of duplicates(nodes.map((node) => node.id))) mistake("map.nodes", `"${id}" is named twice`)
  nodes.forEach((node, index) => {
    if (node.service !== undefined && !services.has(node.service)) {
      mistake(`map.nodes[${index}] (${node.id})`, `"${node.service}" is not a service`)
    }
    if (node.store !== undefined && !stores.has(node.store)) {
      mistake(`map.nodes[${index}] (${node.id})`, `"${node.store}" is not a store`)
    }
    if (node.service !== undefined && node.store !== undefined) {
      mistake(`map.nodes[${index}] (${node.id})`, "names a service and a store; a node is one or the other")
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
