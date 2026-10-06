/**
 * What each entry in an environment costs, from the cost tools its section of the settings names. Where more than one
 * knows an entry, the bill by tag is preferred to Kubernetes' share of it, and an AI provider's report to either.
 */
import { Clock, Effect, type FileSystem, SubscriptionRef } from "effect"
import { type Agent, kubernetesOf, type Service, type StandaloneJob } from "../../shared/catalog"
import type { Cost } from "../../shared/costs"
import { makeAwsJson } from "../aws/json"
import type { Remote } from "../remote"
import type { Sources } from "../settings"
import { Estate } from "../state"
import { agentsIn, inEnvironment, jobsIn } from "../views/catalog"
import { readAiCosts } from "./ai-costs"
import { costExplorerApi, readAwsCosts } from "./aws-costs"
import { type Placed, readOpenCost } from "./opencost"
import type { Failure } from "./run"

type Entry =
  | { readonly kind: "service"; readonly entry: Service }
  | { readonly kind: "job"; readonly entry: StandaloneJob }
  | { readonly kind: "agent"; readonly entry: Agent }

/** The namespace and the workloads an entry runs as in Kubernetes, as its catalog entry names them. */
const kubernetesIn = (each: Entry) => {
  switch (each.kind) {
    case "service":
      return kubernetesOf(each.entry)
    case "agent":
      return each.entry.runtime?.kubernetes
    case "job": {
      const { run } = each.entry
      return "kubernetes" in run
        ? {
            namespace: run.kubernetes.namespace,
            workloads: [{ name: run.kubernetes.cronJob ?? run.kubernetes.job ?? each.entry.name }],
          }
        : undefined
    }
  }
}

/** Where an entry runs in Kubernetes: its namespace, and its workload where it has exactly one. */
const placeOf = (each: Entry): Omit<Placed, "name" | "cost"> | undefined => {
  if (each.entry.cost?.opencost !== undefined) return each.entry.cost.opencost
  const kubernetes = kubernetesIn(each)
  if (kubernetes === undefined) return undefined
  const [only, ...more] = kubernetes.workloads
  return only === undefined || more.length > 0
    ? { namespace: kubernetes.namespace }
    : { namespace: kubernetes.namespace, workload: only.name }
}

const entriesIn = (environment: string) =>
  Effect.gen(function* () {
    const { catalog } = yield* SubscriptionRef.get(yield* Estate)
    const entries: ReadonlyArray<Entry> = [
      ...inEnvironment(catalog, environment).map((entry) => ({ kind: "service" as const, entry })),
      ...jobsIn(catalog, environment).map((entry) => ({ kind: "job" as const, entry })),
      ...agentsIn(catalog, environment).map((entry) => ({ kind: "agent" as const, entry })),
    ]
    return entries
  })

type Reading = Effect.Effect<Readonly<Record<string, Cost>>, Failure, Estate | Remote>

/** The reader of an environment's costs, or none where its section names no cost tool. */
export const costsReader = (
  section: Sources,
  environment: string,
): Effect.Effect<Reading | undefined, never, Remote | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const costs = section.costs
    if (costs === undefined) return undefined
    const { aws, opencost, anthropic, openai } = costs
    const currency = costs.currency ?? "USD"
    const ce = aws === undefined ? undefined : yield* makeAwsJson(costExplorerApi, aws.region, aws.endpoint)
    if (ce === undefined && opencost === undefined && anthropic === undefined && openai === undefined) return undefined
    return Effect.gen(function* () {
      const entries = yield* entriesIn(environment)
      const billed =
        ce === undefined || aws === undefined
          ? {}
          : yield* readAwsCosts(
              ce,
              aws.tag,
              entries.map((each) => each.entry),
              yield* Clock.currentTimeMillis,
              currency,
            )
      // OpenCost is asked only for what the bill by tag does not already split out.
      const placed = entries.flatMap((each): ReadonlyArray<Placed> => {
        const { name, cost } = each.entry
        const place = billed[name] === undefined ? placeOf(each) : undefined
        return place === undefined ? [] : [{ name, ...(cost === undefined ? {} : { cost }), ...place }]
      })
      const shared = opencost === undefined ? {} : yield* readOpenCost(opencost.url, placed, currency)
      // What an agent spends on a model is its provider's to report, and outweighs its share of the cluster.
      const spenders = entries.flatMap(({ entry: { name, cost } }) =>
        cost?.anthropic !== undefined || cost?.openai !== undefined ? [{ name, cost }] : [],
      )
      const models =
        spenders.length === 0
          ? {}
          : yield* readAiCosts(
              { ...(anthropic === undefined ? {} : { anthropic }), ...(openai === undefined ? {} : { openai }) },
              spenders,
              yield* Clock.currentTimeMillis,
              currency,
            )
      return { ...shared, ...billed, ...models }
    })
  })
